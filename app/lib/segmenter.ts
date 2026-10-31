// Pure signal-processing core. No browser or Node APIs, so it runs on the phone
// (in the recorder) and under `node --test`.
//
// Pipeline: accelerometer (incl. gravity) -> gravity-aligned vertical acceleration
// -> fixed-length distance segments (from GPS) -> speed-normalised relative roughness
// index (RRI). RRI is RELATIVE: it is not IRI and is not calibrated across devices.

export type MotionSample = { t: number; ax: number; ay: number; az: number }; // t: epoch ms, a*: m/s^2 incl. gravity
export type GpsFix = { t: number; lat: number; lon: number; accuracy: number }; // t: epoch ms, accuracy: metres

export type SegmentConfig = {
  segmentLengthM: number;
  minSpeedMps: number; // below this the segment is discarded (standing / crawling traffic)
  maxSpeedMps: number; // above this the segment is discarded (GPS glitch)
  maxAccuracyM: number; // GPS fixes worse than this are ignored
  trimStartM: number; // privacy: drop the first metres of a trip (origin)
  trimEndM: number; // privacy: drop the last metres of a trip (destination)
  minSamplesPerSegment: number;
  gravityTauS: number; // time constant of the gravity low-pass filter
  speedExponent: number; // RRI = rms / (speed / refSpeed) ^ exponent. To be validated with repeat passes.
  refSpeedMps: number;
  noiseFloor: number; // per-device stationary vertical RMS (m/s^2), subtracted in quadrature
};

export const DEFAULT_CONFIG: SegmentConfig = {
  segmentLengthM: 25,
  minSpeedMps: 2.5,
  maxSpeedMps: 45,
  maxAccuracyM: 25,
  trimStartM: 200,
  trimEndM: 200,
  minSamplesPerSegment: 10,
  gravityTauS: 1.0,
  speedExponent: 1.0,
  refSpeedMps: 8.33,
  noiseFloor: 0,
};

export type Segment = {
  lat: number;
  lon: number;
  startM: number;
  endM: number;
  rms: number; // vertical RMS after noise-floor correction, m/s^2
  rri: number; // speed-normalised relative roughness index
  speedMps: number;
  samples: number;
};

export type SegmentationStats = {
  gpsFixesIn: number;
  gpsFixesUsed: number;
  totalDistanceM: number;
  samplesIn: number;
  samplesUsed: number;
  segmentsKept: number;
  droppedLowSpeed: number;
  droppedHighSpeed: number;
  droppedCoverage: number;
  note: string | null; // set when nothing could be produced, says why
};

export type SegmentationResult = { segments: Segment[]; stats: SegmentationStats };

const EARTH_R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Gravity-aligned vertical acceleration. Gravity direction is tracked with an
 * exponential low-pass; vertical = (a - g) . g_hat. Invalid entries (first sample,
 * time gaps > 0.5 s, non-increasing time) are NaN and must be skipped by callers.
 */
export function verticalSeries(samples: MotionSample[], tauS: number): number[] {
  const out: number[] = new Array(samples.length);
  let gx = 0;
  let gy = 0;
  let gz = 0;
  let prevT = 0;
  let init = false;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!init) {
      gx = s.ax;
      gy = s.ay;
      gz = s.az;
      prevT = s.t;
      init = true;
      out[i] = NaN;
      continue;
    }
    const dt = (s.t - prevT) / 1000;
    if (dt <= 0) {
      out[i] = NaN;
      continue;
    }
    if (dt > 0.5) {
      gx = s.ax;
      gy = s.ay;
      gz = s.az;
      prevT = s.t;
      out[i] = NaN;
      continue;
    }
    const gm = Math.hypot(gx, gy, gz);
    out[i] = gm > 1e-6 ? ((s.ax - gx) * gx + (s.ay - gy) * gy + (s.az - gz) * gz) / gm : NaN;
    const alpha = dt / (tauS + dt);
    gx += alpha * (s.ax - gx);
    gy += alpha * (s.ay - gy);
    gz += alpha * (s.az - gz);
    prevT = s.t;
  }
  return out;
}

/** Median sample rate in Hz, or null if there is not enough data. */
export function estimateRateHz(samples: MotionSample[]): number | null {
  if (samples.length < 20) return null;
  const dts: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i].t - samples[i - 1].t;
    if (d > 0 && d < 500) dts.push(d);
  }
  if (dts.length < 10) return null;
  dts.sort((a, b) => a - b);
  const med = dts[Math.floor(dts.length / 2)];
  return med > 0 ? 1000 / med : null;
}

/**
 * Stationary vertical RMS (m/s^2) of a phone lying still. Ignores the first 2 s
 * while the gravity filter settles. Returns null if there is too little data.
 */
export function estimateNoiseFloor(samples: MotionSample[], tauS = DEFAULT_CONFIG.gravityTauS): number | null {
  if (samples.length < 50) return null;
  const v = verticalSeries(samples, tauS);
  const t0 = samples[0].t + 2000;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].t < t0 || Number.isNaN(v[i])) continue;
    sum += v[i] * v[i];
    n++;
  }
  return n >= 100 ? Math.sqrt(sum / n) : null;
}

function cleanFixes(fixes: GpsFix[], maxAccuracyM: number): GpsFix[] {
  const good = fixes.filter(
    (f) => Number.isFinite(f.lat) && Number.isFinite(f.lon) && Number.isFinite(f.t) && f.accuracy <= maxAccuracyM,
  );
  good.sort((a, b) => a.t - b.t);
  const out: GpsFix[] = [];
  for (const f of good) {
    if (out.length && f.t <= out[out.length - 1].t) continue;
    out.push(f);
  }
  return out;
}

export function segmentTrip(
  motion: MotionSample[],
  gps: GpsFix[],
  partial: Partial<SegmentConfig> = {},
): SegmentationResult {
  const cfg: SegmentConfig = { ...DEFAULT_CONFIG, ...partial };
  const stats: SegmentationStats = {
    gpsFixesIn: gps.length,
    gpsFixesUsed: 0,
    totalDistanceM: 0,
    samplesIn: motion.length,
    samplesUsed: 0,
    segmentsKept: 0,
    droppedLowSpeed: 0,
    droppedHighSpeed: 0,
    droppedCoverage: 0,
    note: null,
  };

  const fixes = cleanFixes(gps, cfg.maxAccuracyM);
  stats.gpsFixesUsed = fixes.length;
  if (fixes.length < 2) {
    stats.note = `Need at least 2 GPS fixes with accuracy <= ${cfg.maxAccuracyM} m; got ${fixes.length}.`;
    return { segments: [], stats };
  }

  const cum: number[] = [0];
  for (let i = 1; i < fixes.length; i++) {
    cum.push(cum[i - 1] + haversineM(fixes[i - 1].lat, fixes[i - 1].lon, fixes[i].lat, fixes[i].lon));
  }
  const total = cum[cum.length - 1];
  stats.totalDistanceM = total;
  const lo = cfg.trimStartM;
  const hi = total - cfg.trimEndM;
  if (hi - lo < cfg.segmentLengthM) {
    stats.note = `Trip too short (${total.toFixed(0)} m) after trimming ${cfg.trimStartM + cfg.trimEndM} m for privacy.`;
    return { segments: [], stats };
  }

  const sorted = [...motion].sort((a, b) => a.t - b.t);
  const v = verticalSeries(sorted, cfg.gravityTauS);

  type Acc = { sumsq: number; n: number; tFirst: number; tLast: number; dMin: number; dMax: number };
  const groups = new Map<number, Acc>();
  let j = 0;
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i].t;
    if (Number.isNaN(v[i]) || t < fixes[0].t || t > fixes[fixes.length - 1].t) continue;
    while (j < fixes.length - 2 && t > fixes[j + 1].t) j++;
    const span = fixes[j + 1].t - fixes[j].t;
    const d = cum[j] + ((cum[j + 1] - cum[j]) * (t - fixes[j].t)) / span;
    if (d < lo || d >= hi) continue;
    stats.samplesUsed++;
    const idx = Math.floor(d / cfg.segmentLengthM);
    const g = groups.get(idx);
    if (!g) {
      groups.set(idx, { sumsq: v[i] * v[i], n: 1, tFirst: t, tLast: t, dMin: d, dMax: d });
    } else {
      g.sumsq += v[i] * v[i];
      g.n++;
      g.tLast = t;
      g.dMax = d;
    }
  }

  const positionAt = (dist: number): { lat: number; lon: number } => {
    let a = 0;
    let b = cum.length - 1;
    while (b - a > 1) {
      const m = (a + b) >> 1;
      if (cum[m] <= dist) a = m;
      else b = m;
    }
    const seg = cum[b] - cum[a];
    const f = seg > 0 ? (dist - cum[a]) / seg : 0;
    return { lat: fixes[a].lat + f * (fixes[b].lat - fixes[a].lat), lon: fixes[a].lon + f * (fixes[b].lon - fixes[a].lon) };
  };

  const segments: Segment[] = [];
  const idxs = [...groups.keys()].sort((a, b) => a - b);
  for (const idx of idxs) {
    const g = groups.get(idx)!;
    // Require nearly full coverage of the segment, and enough samples.
    if (g.dMax - g.dMin < 0.8 * cfg.segmentLengthM || g.n < cfg.minSamplesPerSegment) {
      stats.droppedCoverage++;
      continue;
    }
    const seconds = (g.tLast - g.tFirst) / 1000;
    const speed = seconds > 0 ? (g.dMax - g.dMin) / seconds : 0;
    if (speed < cfg.minSpeedMps) {
      stats.droppedLowSpeed++;
      continue;
    }
    if (speed > cfg.maxSpeedMps) {
      stats.droppedHighSpeed++;
      continue;
    }
    const rmsRaw = Math.sqrt(g.sumsq / g.n);
    const rms = Math.sqrt(Math.max(0, rmsRaw * rmsRaw - cfg.noiseFloor * cfg.noiseFloor));
    const rri = rms / Math.pow(speed / cfg.refSpeedMps, cfg.speedExponent);
    const mid = positionAt((idx + 0.5) * cfg.segmentLengthM);
    segments.push({
      lat: mid.lat,
      lon: mid.lon,
      startM: idx * cfg.segmentLengthM,
      endM: (idx + 1) * cfg.segmentLengthM,
      rms,
      rri,
      speedMps: speed,
      samples: g.n,
    });
  }
  stats.segmentsKept = segments.length;
  if (!segments.length) {
    stats.note = "No segment met the speed and coverage requirements. Drive at 10 km/h or more with a good GPS lock.";
  }
  return { segments, stats };
}
