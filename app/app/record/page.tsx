"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_CONFIG, estimateNoiseFloor, estimateRateHz, segmentTrip, type SegmentationResult } from "@/lib/segmenter";
import { daypartOfHour } from "@/lib/traffic";
import { GpsCollector, MotionCollector, acquireWakeLock, deviceClass, probeMotion, requestMotionPermission } from "@/lib/sensors";

type Phase = "idle" | "baseline" | "ready" | "recording" | "review" | "uploaded";
type Baseline = { noiseFloor: number | null; rateHz: number | null };
type Live = { samples: number; hz: number | null; accuracy: number | null; distanceM: number; elapsedS: number };

const BASELINE_SECONDS = 12;
const MAX_STILL_NOISE = 0.3; // m/s^2; above this the phone was not still

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10)).join("-");
}

export default function RecordPage() {
  const motion = useRef(new MotionCollector());
  const gps = useRef(new GpsCollector());
  const wake = useRef<WakeLockSentinel | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const tripId = useRef("");
  const hiddenDuringTrip = useRef(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(BASELINE_SECONDS);
  const [baseline, setBaseline] = useState<Baseline>({ noiseFloor: null, rateHz: null });
  const [live, setLive] = useState<Live>({ samples: 0, hz: null, accuracy: null, distanceM: 0, elapsedS: 0 });
  const [result, setResult] = useState<SegmentationResult | null>(null);
  const [rateHz, setRateHz] = useState<number | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<number | null>(null);
  const [gpsAcc, setGpsAcc] = useState<number | null>(null);
  const gpsPoll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const m = motion.current;
    const g = gps.current;
    const onVisibility = async () => {
      if (document.visibilityState === "hidden") {
        if (timer.current) hiddenDuringTrip.current = true;
      } else if (timer.current && !wake.current) {
        wake.current = await acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer.current) clearInterval(timer.current);
      if (gpsPoll.current) clearInterval(gpsPoll.current);
      m.stop();
      g.stop();
      void wake.current?.release();
    };
  }, []);

  function startGpsPreview() {
    gps.current.clear();
    gps.current.start();
    if (gpsPoll.current) clearInterval(gpsPoll.current);
    gpsPoll.current = setInterval(() => setGpsAcc(gps.current.lastAccuracy), 1000);
  }

  function stopGpsPreview() {
    if (gpsPoll.current) clearInterval(gpsPoll.current);
    gpsPoll.current = null;
  }

  async function enableSensors() {
    setError(null);
    setBusy(true);
    try {
      const perm = await requestMotionPermission(); // first await: stays inside the tap gesture
      if (perm === "unsupported") {
        setError("This browser does not expose motion sensors. Open this page on a phone.");
        return;
      }
      if (perm === "denied") {
        setError("Motion access was denied. On iPhone: Settings → Safari → Motion & Orientation Access.");
        return;
      }
      const ok = await probeMotion(motion.current, 3000);
      if (!ok) {
        setError("No accelerometer data arrived. Use a phone (a desktop browser has no motion sensor) and open this page over HTTPS.");
        return;
      }
      if (!("geolocation" in navigator)) {
        setError("This browser has no geolocation.");
        return;
      }
      let noFix = false;
      try {
        await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 }),
        );
      } catch (e) {
        const code = (e as { code?: number }).code;
        if (code === 1) {
          setError("Location access was denied. Allow it for this site (iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using, with Precise Location on).");
          return;
        }
        noFix = true; // permission is fine; there is just no satellite lock yet (common indoors)
      }
      startGpsPreview();
      setWarning(
        noFix
          ? "Location permission is OK but there is no GPS lock yet (common indoors). You can do the baseline now, but go outside with a clear view of the sky before starting a trip."
          : null,
      );
      setPhase("baseline");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function runBaseline() {
    setError(null);
    setBusy(true);
    motion.current.clear();
    motion.current.start();
    const t0 = Date.now();
    setCountdown(BASELINE_SECONDS);
    const iv = setInterval(() => {
      const left = Math.max(0, BASELINE_SECONDS - (Date.now() - t0) / 1000);
      setCountdown(Math.ceil(left));
      if (left <= 0) {
        clearInterval(iv);
        motion.current.stop();
        const samples = motion.current.samples;
        const noise = estimateNoiseFloor(samples);
        const rate = estimateRateHz(samples);
        motion.current.clear();
        setBusy(false);
        if (noise === null) {
          setError("Not enough motion data was captured. Try again.");
        } else if (noise > MAX_STILL_NOISE) {
          setError(`The phone moved during the baseline (noise ${noise.toFixed(2)} m/s²). Lay it flat on a still surface and retry.`);
        } else {
          setBaseline({ noiseFloor: noise, rateHz: rate });
          setPhase("ready");
        }
      }
    }, 250);
  }

  async function startTrip() {
    stopGpsPreview();
    setError(null);
    setWarning(null);
    hiddenDuringTrip.current = false;
    motion.current.clear();
    gps.current.clear();
    motion.current.start();
    gps.current.start();
    wake.current = await acquireWakeLock();
    if (!wake.current) setWarning("Could not keep the screen awake. Keep the screen on and this page in front, or sensors will stop.");
    tripId.current = randomId();
    startedAt.current = Date.now();
    setPhase("recording");
    timer.current = setInterval(() => {
      const recent = motion.current.samples.slice(-120);
      setLive({
        samples: motion.current.samples.length,
        hz: estimateRateHz(recent),
        accuracy: gps.current.lastAccuracy,
        distanceM: gps.current.distanceM,
        elapsedS: (Date.now() - startedAt.current) / 1000,
      });
    }, 1000);
  }

  function stopTrip() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    motion.current.stop();
    gps.current.stop();
    void wake.current?.release();
    wake.current = null;
    const samples = motion.current.samples;
    const res = segmentTrip(samples, gps.current.fixes, { noiseFloor: baseline.noiseFloor ?? 0 });
    setRateHz(estimateRateHz(samples));
    const notes: string[] = [];
    if (hiddenDuringTrip.current) notes.push("The page was in the background during the trip, so some data is missing.");
    if (motion.current.overflowed) notes.push("The recording buffer filled up; the end of the trip was not captured.");
    if (gps.current.error) notes.push(`GPS reported: ${gps.current.error}`);
    setWarning(notes.length ? notes.join(" ") : null);
    setResult(res);
    setPhase("review");
  }

  async function upload() {
    if (!result || (!result.segments.length && !result.slowSegments.length)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId: tripId.current,
          deviceClass: deviceClass(),
          rateHz,
          daypart: daypartOfHour(new Date(startedAt.current).getHours()), // local time of day, 4 bands only
          slow: result.slowSegments.map((s) => ({ lat: +s.lat.toFixed(5), lon: +s.lon.toFixed(5), speedKph: +(s.speedMps * 3.6).toFixed(1) })),
          segments: result.segments.map((s) => ({
            lat: +s.lat.toFixed(5),
            lon: +s.lon.toFixed(5),
            rri: +s.rri.toFixed(4),
            speedKph: +(s.speedMps * 3.6).toFixed(1),
            samples: s.samples,
          })),
        }),
      });
      const json = (await res.json()) as { ok?: boolean; stored?: number; slowStored?: number; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `Upload failed (${res.status})`);
      setUploaded((json.stored ?? result.segments.length) + (json.slowStored ?? 0));
      setPhase("uploaded");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    startGpsPreview();
    setResult(null);
    setWarning(null);
    setError(null);
    setPhase("ready");
  }

  const gpsStatus = (
    <p className="small muted">
      GPS:{" "}
      {gpsAcc === null
        ? "waiting for a fix… go outside with a clear view of the sky"
        : `${gpsAcc.toFixed(0)} m accuracy${gpsAcc > DEFAULT_CONFIG.maxAccuracyM ? " (too coarse, keep waiting)" : " ✓"}`}
    </p>
  );

  const medianRri = result && result.segments.length ? median(result.segments.map((s) => s.rri)) : null;

  return (
    <div className="content">
      <h1>Record a trip</h1>
      <p className="lead">Mount the phone firmly in the vehicle (dashboard or cradle, not loose in a bag) and keep this page open with the screen on.</p>

      {error && <div className="error">{error}</div>}
      {warning && <div className="warn">{warning}</div>}

      {phase === "idle" && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>1. Enable sensors</h2>
          <p className="muted">We read the accelerometer and GPS on this device. Raw data never leaves the phone.</p>
          <button onClick={enableSensors} disabled={busy}>{busy ? "Checking sensors…" : "Enable motion and location"}</button>
        </div>
      )}

      {phase === "baseline" && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>2. Device baseline</h2>
          <p className="muted">Lay the phone flat and still for {BASELINE_SECONDS} seconds. This measures this phone’s own sensor noise so it can be subtracted.</p>
          {gpsStatus}
          <div className="row">
            <button onClick={runBaseline} disabled={busy}>{busy ? `Hold still… ${countdown}s` : "Start baseline"}</button>
            <button className="secondary" onClick={() => setPhase("ready")} disabled={busy}>Skip (less accurate)</button>
          </div>
        </div>
      )}

      {phase === "ready" && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>3. Ready</h2>
          <div className="grid">
            <div className="stat"><div className="k">Noise floor</div><div className="v">{baseline.noiseFloor === null ? "not measured" : `${baseline.noiseFloor.toFixed(3)} m/s²`}</div></div>
            <div className="stat"><div className="k">Sample rate</div><div className="v">{baseline.rateHz === null ? "—" : `${baseline.rateHz.toFixed(0)} Hz`}</div></div>
          </div>
          {baseline.rateHz !== null && baseline.rateHz < 20 && (
            <div className="warn">This phone reports motion at under 20 Hz, which is low for road vibration. Results will be coarse.</div>
          )}
          {gpsStatus}
          <p className="small muted">The first and last {DEFAULT_CONFIG.trimStartM} m of every trip are discarded automatically so your start and end points are never stored.</p>
          <div className="row">
            <button onClick={startTrip}>Start recording</button>
            <button className="secondary" onClick={() => setPhase("baseline")}>Redo baseline</button>
          </div>
        </div>
      )}

      {phase === "recording" && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Recording…</h2>
          <div className="grid">
            <div className="stat"><div className="k">Time</div><div className="v">{Math.floor(live.elapsedS / 60)}:{String(Math.floor(live.elapsedS % 60)).padStart(2, "0")}</div></div>
            <div className="stat"><div className="k">Distance</div><div className="v">{(live.distanceM / 1000).toFixed(2)} km</div></div>
            <div className="stat"><div className="k">Motion rate</div><div className="v">{live.hz === null ? "—" : `${live.hz.toFixed(0)} Hz`}</div></div>
            <div className="stat"><div className="k">GPS accuracy</div><div className="v">{live.accuracy === null ? "no fix" : `${live.accuracy.toFixed(0)} m`}</div></div>
          </div>
          {live.accuracy !== null && live.accuracy > DEFAULT_CONFIG.maxAccuracyM && (
            <div className="warn">GPS accuracy is worse than {DEFAULT_CONFIG.maxAccuracyM} m; those fixes are ignored.</div>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={stopTrip}>Stop and review</button>
          </div>
        </div>
      )}

      {phase === "review" && result && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Review</h2>
          <div className="grid">
            <div className="stat"><div className="k">Segments kept</div><div className="v">{result.stats.segmentsKept}</div></div>
            <div className="stat"><div className="k">Trip length</div><div className="v">{(result.stats.totalDistanceM / 1000).toFixed(2)} km</div></div>
            <div className="stat"><div className="k">Median RRI</div><div className="v">{medianRri === null ? "—" : medianRri.toFixed(2)}</div></div>
            <div className="stat"><div className="k">GPS fixes used</div><div className="v">{result.stats.gpsFixesUsed}/{result.stats.gpsFixesIn}</div></div>
          </div>
          {result.stats.note && <div className="warn">{result.stats.note}</div>}
          {(result.stats.segmentsKept > 0 || result.slowSegments.length > 0) && (
            <p className="small muted">
              Dropped: {result.stats.droppedLowSpeed} too slow, {result.stats.droppedHighSpeed} too fast, {result.stats.droppedCoverage} incomplete.
              Only {result.stats.segmentsKept} roughness summaries and {result.slowSegments.length} slow-traffic speed readings will be uploaded: location rounded to ~22 m, time of day as one of four bands (no timestamps), no raw sensor data, no identity.
            </p>
          )}
          <div className="row">
            <button onClick={upload} disabled={busy || (result.segments.length === 0 && result.slowSegments.length === 0)}>{busy ? "Uploading…" : "Upload segments"}</button>
            <button className="danger" onClick={discard} disabled={busy}>Discard</button>
          </div>
        </div>
      )}

      {phase === "uploaded" && (
        <div className="card">
          <div className="ok">Uploaded {uploaded} segments. Thank you.</div>
          <div className="row">
            <a className="btn" href="/">See the map</a>
            <button className="secondary" onClick={() => { startGpsPreview(); setResult(null); setUploaded(null); setPhase("ready"); }}>Record another trip</button>
          </div>
        </div>
      )}
    </div>
  );
}
