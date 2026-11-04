"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { DAYPARTS, SLOW_KPH } from "@/lib/traffic";
import { groupCells, median } from "@/lib/stretches";
import { roughnessLevel, speedLevel, type Level } from "@/lib/level";
import { CELL_DEG } from "@/lib/grid";
import {
  Coach, Detail, EmptyState, ErrorState, HelpDialog, Legend, LoadingState, Sheet, StretchList, Summary, TopBar,
  type Band, type Mode, type Stretch,
} from "./map-ui";
import type { ExpressionSpecification, Map as MlMap, StyleSpecification } from "maplibre-gl";

type Cell = { id: string; lat: number; lon: number; rri: number; trips: number; spread: number | null; speedKph: number };
type TrafficBand = { daypart: number; n: number; speedKph: number };
type TrafficCell = { id: string; lat: number; lon: number; bands: TrafficBand[] };
type CellsResponse = { cells: Cell[]; traffic: TrafficCell[]; totalSegments: number; totalTrips: number };
type Item = { id: string; lat: number; lon: number; v: number; trips: number; speedKph: number; spread: number | null; bands: Band[] };
type Built = Stretch & { bounds: [[number, number], [number, number]]; cellIds: string[] };
type Scale = { s0: number; s1: number; s2: number; flat: boolean };

const DEFAULT_CENTER: [number, number] = [3.3792, 6.5244];
const CELL_M = CELL_DEG * 111320; // about 22 m
const LIGHT_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};
const SEEN_KEY = "wildroads.coach.v1";

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];
}
function makeScale(values: number[]): Scale {
  const sorted = [...values].sort((a, b) => a - b);
  const eps = 1e-6;
  const s0 = quantile(sorted, 0.1);
  const s1 = Math.max(quantile(sorted, 0.5), s0 + eps);
  const s2 = Math.max(quantile(sorted, 0.9), s1 + eps);
  const flat = sorted.length < 2 || sorted[sorted.length - 1] - sorted[0] < 1e-6;
  return { s0, s1, s2, flat };
}
// Traffic colours use a fixed scale on "slowness" = 60 - speed, so a colour always means the same speed.
const TRAFFIC_SCALE: Scale = { s0: 0, s1: 30, s2: 60 - SLOW_KPH, flat: false };
const slowness = (kph: number) => 60 - Math.min(60, Math.max(0, kph));

function trafficIn(c: TrafficCell, part: number): { n: number; speedKph: number } | null {
  const bands = part < 0 ? c.bands : c.bands.filter((b) => b.daypart === part);
  const n = bands.reduce((a, b) => a + b.n, 0);
  if (!n) return null;
  return { n, speedKph: bands.reduce((a, b) => a + b.speedKph * b.n, 0) / n };
}

function parseId(id: string): { a: number; b: number } {
  const [a, b] = id.split(":").map(Number);
  return { a, b };
}

function build(items: Item[]): { stretches: Built[]; links: [Item, Item][] } {
  const groups = groupCells(items.map((i) => parseId(i.id)));
  const stretches: Built[] = [];
  const links: [Item, Item][] = [];
  for (const g of groups) {
    const ms = g.members.map((k) => items[k]);
    for (const [x, y] of g.links) links.push([items[x], items[y]]);
    const mean = (f: (i: Item) => number) => ms.reduce((a, i) => a + f(i), 0) / ms.length;
    const spreads = ms.map((i) => i.spread).filter((s): s is number => s !== null);
    const bands: Band[] = [];
    for (let p = 0; p < DAYPARTS.length; p++) {
      let n = 0, w = 0;
      for (const i of ms) for (const b of i.bands) if (b.daypart === p) { n += b.n; w += b.speedKph * b.n; }
      if (n) bands.push({ daypart: p, n, speedKph: w / n });
    }
    const lats = ms.map((i) => i.lat), lons = ms.map((i) => i.lon);
    stretches.push({
      id: ms.map((i) => i.id).sort()[0],
      lat: mean((i) => i.lat),
      lon: mean((i) => i.lon),
      lengthM: ms.length * CELL_M,
      v: mean((i) => i.v),
      trips: Math.max(1, Math.round(median(ms.map((i) => i.trips)))),
      speedKph: mean((i) => i.speedKph),
      spread: spreads.length ? mean((i) => i.spread ?? 0) : null,
      bands,
      bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      cellIds: ms.map((i) => i.id),
    });
  }
  return { stretches, links };
}

const lineW = (extra: number): ExpressionSpecification => ["interpolate", ["exponential", 2], ["zoom"], 10, 1.5 + extra, 18, 12 + extra];
const dotR = (extra: number): ExpressionSpecification => ["interpolate", ["exponential", 2], ["zoom"], 10, 1 + extra, 18, 7 + extra];

type Pal = { ramp: string[]; tramp: string[]; flat: string; halo: string; panel: string };

function applyData(map: MlMap, items: Item[], stretchOf: Map<string, string>, links: [Item, Item][], sc: Scale, pal: Pal, mode: Mode, selected: string | null) {
  for (const id of ["sel-line", "sel-dot", "open-line", "line", "casing", "dot"]) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of ["links", "dots"]) if (map.getSource(id)) map.removeSource(id);
  if (!items.length) return;
  const ramp = mode === "traffic" ? pal.tramp : pal.ramp;
  const color: string | ExpressionSpecification = sc.flat
    ? pal.flat
    : ["interpolate", ["linear"], ["get", "v"], sc.s0, ramp[0], sc.s1, ramp[1], sc.s2, ramp[2]];

  map.addSource("links", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: links.map(([a, b]) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
        properties: { sid: stretchOf.get(a.id) ?? "", v: (a.v + b.v) / 2, solid: a.trips >= 2 && b.trips >= 2 ? 1 : 0 },
      })),
    },
  });
  map.addSource("dots", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: items.map((i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [i.lon, i.lat] },
        properties: { sid: stretchOf.get(i.id) ?? "", v: i.v, solid: i.trips >= 2 ? 1 : 0 },
      })),
    },
  });
  const lc = { "line-cap": "round", "line-join": "round" } as const;
  map.addLayer({ id: "casing", type: "line", source: "links", layout: lc, paint: { "line-width": lineW(3), "line-color": pal.panel, "line-opacity": 0.9 } });
  map.addLayer({ id: "line", type: "line", source: "links", layout: lc, paint: { "line-width": lineW(0), "line-color": color } });
  map.addLayer({ id: "open-line", type: "line", source: "links", filter: ["==", ["get", "solid"], 0], layout: { "line-join": "round" }, paint: { "line-width": lineW(-1), "line-color": pal.panel, "line-opacity": 0.75, "line-dasharray": [0.6, 1.6] } });
  map.addLayer({ id: "dot", type: "circle", source: "dots", paint: { "circle-radius": dotR(0), "circle-color": color, "circle-stroke-width": 1.5, "circle-stroke-color": pal.panel } });
  const f: ["==", ["get", string], string] = ["==", ["get", "sid"], selected ?? ""];
  map.addLayer({ id: "sel-line", type: "line", source: "links", filter: f, layout: lc, paint: { "line-width": lineW(7), "line-color": pal.halo, "line-opacity": 0.28, "line-blur": 3 } });
  map.addLayer({ id: "sel-dot", type: "circle", source: "dots", filter: f, paint: { "circle-radius": dotR(5), "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 2.5, "circle-stroke-color": pal.halo } });
}

export default function MapPage() {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const fitted = useRef(false);
  const deepLinked = useRef(false);
  const selectedRef = useRef<string | null>(null);

  const [data, setData] = useState<CellsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState<0 | 1 | 2>(0);
  const [mode, setMode] = useState<Mode>("roughness");
  const [part, setPart] = useState(-1);
  const [help, setHelp] = useState(false);
  const [coach, setCoach] = useState(false);
  const [shared, setShared] = useState<string | null>(null);
  const [styleVersion, setStyleVersion] = useState(0);
  const [pal, setPal] = useState<Pal>({ ramp: ["#3b82c4", "#f28f3b", "#b3123f"], tramp: ["#1aa6a0", "#f2b134", "#d6283f"], flat: "#8a96a3", halo: "#13202b", panel: "#ffffff" });

  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    setPal({ ramp: [v("--r0"), v("--r1"), v("--r2")], tramp: [v("--t0"), v("--t1"), v("--t2")], flat: v("--flat"), halo: v("--halo"), panel: v("--panel") });
    try {
      if (!localStorage.getItem(SEEN_KEY)) setCoach(true);
    } catch {
      /* storage unavailable: no coach card */
    }
    const q = new URLSearchParams(window.location.search);
    if (q.get("layer") === "traffic") setMode("traffic");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch("/api/cells", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const j = (await r.json().catch(() => null)) as { error?: string } | null;
          throw new Error(j?.error ?? `The server answered ${r.status}.`);
        }
        return (await r.json()) as CellsResponse;
      })
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const phonePad = () => (window.matchMedia("(max-width: 899px)").matches ? { top: 120, left: 40, right: 40, bottom: 260 } : { top: 90, left: 460, right: 80, bottom: 90 });

  // Create the map once.
  useEffect(() => {
    let disposed = false;
    let map: MlMap | null = null;
    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (disposed || !canvasRef.current) return;
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      map = new maplibregl.Map({ container: canvasRef.current, style: dark ? DARK_STYLE : LIGHT_STYLE, center: DEFAULT_CENTER, zoom: 11, attributionControl: { compact: true } });
      const m = map;
      mapRef.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      m.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");
      let fellBack = false;
      m.on("error", () => {
        if (!fellBack && !m.isStyleLoaded()) {
          fellBack = true;
          m.setStyle(OSM_STYLE);
        }
      });
      m.on("style.load", () => setStyleVersion((n) => n + 1));
      const layers = () => ["line", "dot"].filter((l) => m.getLayer(l));
      m.on("click", (e) => {
        const ls = layers();
        if (!ls.length) return;
        const { x, y } = e.point;
        const hits = m.queryRenderedFeatures([[x - 12, y - 12], [x + 12, y + 12]], { layers: ls });
        const sid = hits[0]?.properties?.sid as string | undefined;
        setSelected(sid || null);
        if (sid) setSnap((s) => (s === 0 ? 1 : s));
      });
      m.on("mousemove", (e) => {
        const ls = layers();
        m.getCanvas().style.cursor = ls.length && m.queryRenderedFeatures(e.point, { layers: ls }).length ? "pointer" : "";
      });
    })();
    return () => {
      disposed = true;
      mapRef.current = null;
      map?.remove();
    };
  }, []);

  const items: Item[] = useMemo(() => {
    if (mode === "traffic") {
      const out: Item[] = [];
      for (const c of data?.traffic ?? []) {
        const t = trafficIn(c, part);
        if (t) {
          const bands = part < 0 ? c.bands : c.bands.filter((b) => b.daypart === part);
          out.push({ id: c.id, lat: c.lat, lon: c.lon, v: slowness(t.speedKph), trips: t.n, speedKph: t.speedKph, spread: null, bands });
        }
      }
      return out;
    }
    return (data?.cells ?? []).map((c) => ({ id: c.id, lat: c.lat, lon: c.lon, v: c.rri, trips: c.trips, speedKph: c.speedKph, spread: c.spread, bands: [] }));
  }, [mode, part, data]);

  const { stretches, links } = useMemo(() => build(items), [items]);
  const stretchOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stretches) for (const id of s.cellIds) m.set(id, s.id);
    return m;
  }, [stretches]);
  const sortedAll = useMemo(() => items.map((i) => i.v).sort((a, b) => a - b), [items]);
  const scale = useMemo(() => (mode === "traffic" ? TRAFFIC_SCALE : makeScale(items.map((i) => i.v))), [mode, items]);
  const levelOf = useCallback(
    (s: Stretch): Level | null => (mode === "traffic" ? speedLevel(s.speedKph) : roughnessLevel(s.v, sortedAll)),
    [mode, sortedAll],
  );

  // Draw whenever the data, the palette or the basemap style changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data || styleVersion === 0) return;
    applyData(map, items, stretchOf, links, scale, pal, mode, selectedRef.current);
    if (!fitted.current && items.length) {
      fitted.current = true;
      const all = stretches.map((s) => s.bounds);
      const minLon = Math.min(...all.map((b) => b[0][0])), minLat = Math.min(...all.map((b) => b[0][1]));
      const maxLon = Math.max(...all.map((b) => b[1][0])), maxLat = Math.max(...all.map((b) => b[1][1]));
      map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: phonePad(), maxZoom: 16.5, duration: 0 });
    }
  }, [data, items, stretches, stretchOf, links, scale, pal, mode, styleVersion]);

  useEffect(() => {
    selectedRef.current = selected;
    const map = mapRef.current;
    if (!map) return;
    const f: ["==", ["get", string], string] = ["==", ["get", "sid"], selected ?? ""];
    if (map.getLayer("sel-line")) map.setFilter("sel-line", f);
    if (map.getLayer("sel-dot")) map.setFilter("sel-dot", f);
  }, [selected, styleVersion]);

  const km = stretches.reduce((a, s) => a + s.lengthM, 0) / 1000;
  const confirmedPct = items.length ? (items.filter((i) => i.trips >= 2).length / items.length) * 100 : 0;
  const ranked = useMemo(() => [...stretches].sort((a, b) => b.v - a.v), [stretches]);
  const top = ranked.slice(0, 5);
  const sel = useMemo(() => stretches.find((s) => s.id === selected) ?? null, [stretches, selected]);
  const hasTraffic = (data?.traffic.length ?? 0) > 0;
  const empty = !!data && (data.cells.length === 0 && !hasTraffic);

  const open = useCallback((s: Built, expand = true) => {
    setSelected(s.id);
    if (expand) setSnap((n) => (n === 0 ? 1 : n));
    const phone = window.matchMedia("(max-width: 899px)").matches;
    mapRef.current?.fitBounds(s.bounds, { padding: phone ? { top: 120, left: 50, right: 50, bottom: Math.round(window.innerHeight * 0.55) } : phonePad(), maxZoom: 17.5, duration: 700 });
  }, []);

  // Deep link: /?at=lat,lon picks the nearest stretch once data is in.
  useEffect(() => {
    if (deepLinked.current || !stretches.length) return;
    const at = new URLSearchParams(window.location.search).get("at");
    deepLinked.current = true;
    if (!at) return;
    const [la, lo] = at.split(",").map(Number);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
    let best: Built | null = null, bd = Infinity;
    for (const s of stretches) {
      const d = (s.lat - la) ** 2 + (s.lon - lo) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    if (best) {
      fitted.current = true;
      open(best);
    }
  }, [stretches, open]);

  function changeMode(m: Mode) {
    setMode(m);
    setSelected(null);
  }
  function share() {
    if (!sel) return;
    const url = `${window.location.origin}/?at=${sel.lat.toFixed(5)},${sel.lon.toFixed(5)}&layer=${mode}`;
    const done = (t: string) => {
      setShared(t);
      setTimeout(() => setShared(null), 2200);
    };
    if (navigator.share) navigator.share({ title: "A road on Wildroads", url }).catch(() => undefined);
    else navigator.clipboard?.writeText(url).then(() => done("Link copied"), () => done("Copy failed"));
  }
  function dismissCoach() {
    setCoach(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  const leadStretch = ranked[0] ?? null;
  const loading = !data && !error;
  const title = mode === "traffic" ? "Slowest stretches" : "Roughest stretches";
  const rows = (mode === "traffic" ? [...stretches].sort((a, b) => a.speedKph - b.speedKph).slice(0, 5) : top).map((s) => ({ stretch: s, level: levelOf(s) }));

  return (
    <div className={`mapshell m-shell snap-${snap} mode-${mode}`}>
      <div className="mapcanvas" ref={canvasRef} />
      <TopBar mode={mode} onMode={changeMode} part={part} onPart={setPart} hasTraffic={hasTraffic} onHelp={() => setHelp(true)} />

      <Sheet
        snap={snap}
        onSnap={setSnap}
        header={
          loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} /> : empty ? <EmptyState /> : stretches.length === 0 ? (
            <div className="m-state"><p><strong>No speed readings for this time of day yet.</strong></p><p>Try another time of day.</p></div>
          ) : (
            <Summary
              mode={mode}
              km={km}
              trips={data?.totalTrips ?? 0}
              confirmedPct={confirmedPct}
              part={part}
              lead={leadStretch && !sel ? { stretch: mode === "traffic" ? rows[0].stretch : leadStretch, level: mode === "traffic" ? rows[0].level : levelOf(leadStretch), onOpen: () => open(mode === "traffic" ? rows[0].stretch as Built : leadStretch as Built) } : null}
            />
          )
        }
      >
        {sel ? (
          <Detail mode={mode} stretch={sel} level={levelOf(sel)} onBack={() => setSelected(null)} onShare={share} shared={shared} />
        ) : (
          stretches.length > 0 && (
            <>
              {coach && <Coach onClose={dismissCoach} />}
              <StretchList title={title} rows={rows} mode={mode} onOpen={(s) => open(s as Built)} />
              <Legend mode={mode} />
            </>
          )
        )}
      </Sheet>

      <Link className="m-fab" href="/record">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor" /><circle cx="12" cy="12" r="9" /></svg>
        Record a trip
      </Link>
      {help && <HelpDialog onClose={() => setHelp(false)} />}
    </div>
  );
}
