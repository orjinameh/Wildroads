// Names a road stretch from its centre using OpenStreetMap's public reverse-geocoder (Nominatim).
// Only the centre of an already-public ~22 m cell group is sent; nothing about any trip or person.
// Results are cached in the browser, requests are spaced out (Nominatim asks for at most 1 per second),
// and any failure falls back to plain coordinates, so the UI never depends on this service.

const CACHE_KEY = "wildroads.place.v1";
const SPACING_MS = 1100;

type Cache = Record<string, string>;
let cache: Cache | null = null;
const failed = new Set<string>(); // not retried during this visit
let queue: Promise<unknown> = Promise.resolve();
let lastAt = 0;

function load(): Cache {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Cache;
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache ?? {}));
  } catch {
    /* storage unavailable: names are simply not remembered */
  }
}

const keyOf = (lat: number, lon: number) => `${lat.toFixed(3)},${lon.toFixed(3)}`; // ~110 m

export function formatCoord(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;
}

export function cachedPlace(lat: number, lon: number): string | null {
  return load()[keyOf(lat, lon)] ?? null;
}

type Reverse = { address?: Record<string, string> };

export function nameFrom(r: Reverse): string | null {
  const a = r.address;
  if (!a) return null;
  const road = a.road || a.pedestrian || a.footway || a.path || a.cycleway;
  const area = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.town || a.village || a.city;
  if (road && area && road !== area) return `${road}, ${area}`;
  return road || area || null;
}

export function resolvePlace(lat: number, lon: number): Promise<string | null> {
  const k = keyOf(lat, lon);
  const hit = load()[k];
  if (hit) return Promise.resolve(hit);
  if (failed.has(k)) return Promise.resolve(null);

  const job = queue.then(async () => {
    const again = load()[k];
    if (again) return again;
    const wait = lastAt + SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 7000);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&addressdetails=1&accept-language=en&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`,
        { signal: ctl.signal },
      );
      clearTimeout(timer);
      if (!res.ok) throw new Error(String(res.status));
      const name = nameFrom((await res.json()) as Reverse);
      if (!name) throw new Error("no name");
      load()[k] = name;
      save();
      return name;
    } catch {
      failed.add(k);
      return null;
    }
  });
  queue = job.catch(() => null);
  return job as Promise<string | null>;
}
