// Maths checks with analytically known inputs (a sine of known amplitude has RMS A/sqrt(2)).
// These are unit tests of the filter, not product data: the app itself never generates signals.
import test from "node:test";
import assert from "node:assert/strict";
import { segmentTrip, verticalSeries, estimateNoiseFloor, estimateRateHz, type MotionSample, type GpsFix } from "./segmenter.ts";

const M_PER_DEG = 111194.9; // matches haversine with R = 6371000

function rmsOf(v: number[], skipFirst = 0): number {
  const x = v.slice(skipFirst).filter((n) => !Number.isNaN(n));
  return Math.sqrt(x.reduce((s, n) => s + n * n, 0) / x.length);
}

function motion(opts: { seconds: number; hz: number; amp: number; freq: number; gdir: [number, number, number]; along?: boolean }): MotionSample[] {
  const [dx, dy, dz] = opts.gdir;
  const m = Math.hypot(dx, dy, dz);
  const u = [dx / m, dy / m, dz / m];
  // a vector perpendicular to u
  const p = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const c = [u[1] * p[2] - u[2] * p[1], u[2] * p[0] - u[0] * p[2], u[0] * p[1] - u[1] * p[0]];
  const cm = Math.hypot(c[0], c[1], c[2]);
  const w = c.map((x) => x / cm);
  const dir = opts.along ? u : w; // vibrate along gravity (vertical) or perpendicular to it
  const out: MotionSample[] = [];
  const n = Math.round(opts.seconds * opts.hz);
  for (let i = 0; i < n; i++) {
    const t = 1_700_000_000_000 + (i * 1000) / opts.hz;
    const vib = opts.amp * Math.sin(2 * Math.PI * opts.freq * (i / opts.hz));
    out.push({ t, ax: 9.81 * u[0] + vib * dir[0], ay: 9.81 * u[1] + vib * dir[1], az: 9.81 * u[2] + vib * dir[2] });
  }
  return out;
}

test("vertical RMS of a 1.0 m/s^2 sine along gravity is ~0.707, for a tilted phone", () => {
  const s = motion({ seconds: 20, hz: 100, amp: 1.0, freq: 5, gdir: [0.3, 0.2, 0.93], along: true });
  const r = rmsOf(verticalSeries(s, 1.0), 300);
  assert.ok(Math.abs(r - Math.SQRT1_2) < 0.03, `got ${r}`);
});

test("vibration perpendicular to gravity contributes ~0 vertical", () => {
  const s = motion({ seconds: 20, hz: 100, amp: 1.0, freq: 5, gdir: [0.3, 0.2, 0.93], along: false });
  const r = rmsOf(verticalSeries(s, 1.0), 300);
  assert.ok(r < 0.05, `got ${r}`);
});

test("rate and noise-floor estimators", () => {
  const s = motion({ seconds: 15, hz: 60, amp: 0, freq: 1, gdir: [0, 0, 1], along: true });
  assert.ok(Math.abs(estimateRateHz(s)! - 60) < 1);
  assert.ok(estimateNoiseFloor(s)! < 1e-6);
  assert.equal(estimateNoiseFloor(s.slice(0, 10)), null);
});

function straightTrip(speed: number, lengthM: number, hz: number, amp: number, accuracy = 5) {
  const seconds = lengthM / speed;
  const mot = motion({ seconds, hz, amp, freq: 6, gdir: [0, 0, 1], along: true });
  const t0 = mot[0].t;
  const gps: GpsFix[] = [];
  for (let s = 0; s <= Math.floor(seconds); s++) {
    gps.push({ t: t0 + s * 1000, lat: 6.5 + (s * speed) / M_PER_DEG, lon: 3.3, accuracy });
  }
  return { mot, gps };
}

test("segments a straight 1 km trip at 10 m/s with the expected speed-normalised RRI", () => {
  const { mot, gps } = straightTrip(10, 1000, 100, 1.0);
  const res = segmentTrip(mot, gps);
  assert.ok(res.segments.length >= 20 && res.segments.length <= 25, `segments ${res.segments.length}`);
  const expected = Math.SQRT1_2 / (10 / 8.33);
  for (const s of res.segments) {
    assert.ok(Math.abs(s.rri - expected) / expected < 0.08, `rri ${s.rri} vs ${expected}`);
    assert.ok(Math.abs(s.speedMps - 10) < 0.5);
  }
  // first segment must start after the 200 m privacy trim
  assert.ok(res.segments[0].startM >= 200);
  assert.ok(res.segments[res.segments.length - 1].endM <= res.stats.totalDistanceM - 200 + 1e-6);
});

test("no segments at walking pace, and the reason is reported", () => {
  const { mot, gps } = straightTrip(1, 600, 100, 1.0);
  const res = segmentTrip(mot, gps, { trimStartM: 50, trimEndM: 50 });
  assert.equal(res.segments.length, 0);
  assert.ok(res.stats.droppedLowSpeed > 0);
  assert.ok(res.stats.note);
});

test("subtracting a noise floor equal to the measured RMS removes almost all of the signal", () => {
  const { mot, gps } = straightTrip(10, 1000, 100, 1.0);
  const base = segmentTrip(mot, gps);
  assert.ok(base.segments.length > 0);
  const floor = base.segments[0].rms; // the measured (not nominal) RMS
  const res = segmentTrip(mot, gps, { noiseFloor: floor });
  assert.equal(res.segments.length, base.segments.length);
  for (let i = 0; i < res.segments.length; i++) {
    assert.ok(res.segments[i].rri < 0.2 * base.segments[i].rri, `rri ${res.segments[i].rri} vs ${base.segments[i].rri}`);
  }
});

test("poor GPS accuracy yields an empty result with an explanation, not guesses", () => {
  const { mot, gps } = straightTrip(10, 1000, 100, 1.0, 100);
  const res = segmentTrip(mot, gps);
  assert.equal(res.segments.length, 0);
  assert.match(res.stats.note ?? "", /GPS/);
});

test("too-short trips are rejected after privacy trimming", () => {
  const { mot, gps } = straightTrip(10, 300, 100, 1.0);
  const res = segmentTrip(mot, gps);
  assert.equal(res.segments.length, 0);
  assert.match(res.stats.note ?? "", /too short/i);
});
