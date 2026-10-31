// Browser sensor access. Everything here reads REAL device sensors; nothing is generated.
import { haversineM, type GpsFix, type MotionSample } from "./segmenter";

export type MotionPermission = "granted" | "denied" | "unsupported";

/** Must be called directly from a user gesture (iOS Safari requires it). */
export async function requestMotionPermission(): Promise<MotionPermission> {
  if (typeof window === "undefined" || typeof DeviceMotionEvent === "undefined") return "unsupported";
  const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<"granted" | "denied"> };
  if (typeof DME.requestPermission === "function") {
    try {
      return await DME.requestPermission();
    } catch {
      return "denied";
    }
  }
  return "granted";
}

const MAX_SAMPLES = 1_000_000; // ~4.6 h at 60 Hz

export class MotionCollector {
  samples: MotionSample[] = [];
  overflowed = false;
  private listening = false;

  private handler = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    if (this.samples.length >= MAX_SAMPLES) {
      this.overflowed = true;
      return;
    }
    this.samples.push({ t: performance.timeOrigin + e.timeStamp, ax: a.x, ay: a.y, az: a.z });
  };

  start() {
    if (this.listening) return;
    window.addEventListener("devicemotion", this.handler);
    this.listening = true;
  }

  stop() {
    if (!this.listening) return;
    window.removeEventListener("devicemotion", this.handler);
    this.listening = false;
  }

  clear() {
    this.samples = [];
    this.overflowed = false;
  }
}

/** Resolves true only if real accelerometer data arrives within the timeout. */
export async function probeMotion(collector: MotionCollector, timeoutMs: number): Promise<boolean> {
  collector.clear();
  collector.start();
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs && collector.samples.length < 5) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const ok = collector.samples.length >= 5;
  collector.stop();
  collector.clear();
  return ok;
}

export class GpsCollector {
  fixes: GpsFix[] = [];
  lastAccuracy: number | null = null;
  distanceM = 0;
  error: string | null = null;
  private watchId: number | null = null;

  start() {
    if (this.watchId !== null || !("geolocation" in navigator)) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const fix: GpsFix = { t: pos.timestamp, lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
        this.lastAccuracy = fix.accuracy;
        const prev = this.fixes[this.fixes.length - 1];
        if (fix.accuracy <= 25) {
          if (prev && prev.accuracy <= 25) this.distanceM += haversineM(prev.lat, prev.lon, fix.lat, fix.lon);
        }
        this.fixes.push(fix);
      },
      (err) => {
        this.error = err.message || "GPS error";
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  clear() {
    this.fixes = [];
    this.lastAccuracy = null;
    this.distanceM = 0;
    this.error = null;
  }
}

export async function acquireWakeLock(): Promise<WakeLockSentinel | null> {
  try {
    if ("wakeLock" in navigator) return await navigator.wakeLock.request("screen");
  } catch {
    /* not available or denied: the recorder warns the user to keep the screen on */
  }
  return null;
}

/** Coarse device class only; no fingerprinting. */
export function deviceClass(): "ios" | "android" | "other" {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}
