"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ExpressionSpecification, GeoJSONSource, Map as MlMap, StyleSpecification } from "maplibre-gl";

type Cell = { id: string; lat: number; lon: number; rri: number; trips: number; spread: number | null; speedKph: number };
type CellsResponse = { cells: Cell[]; totalSegments: number; totalTrips: number };
type Scale = { s0: number; s1: number; s2: number; flat: boolean };

const DEFAULT_CENTER: [number, number] = [3.3792, 6.5244];
const LIGHT_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];
}

function makeScale(cells: Cell[]): Scale {
  const sorted = cells.map((c) => c.rri).sort((a, b) => a - b);
  const eps = 1e-6;
  const s0 = quantile(sorted, 0.1);
  const s1 = Math.max(quantile(sorted, 0.5), s0 + eps);
  const s2 = Math.max(quantile(sorted, 0.9), s1 + eps);
  const flat = sorted.length < 2 || sorted[sorted.length - 1] - sorted[0] < 1e-6;
  return { s0, s1, s2, flat };
}

function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const A = p(a), B = p(b);
  const c = A.map((x, i) => Math.round(x + (B[i] - x) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function colorFor(v: number, sc: Scale, ramp: string[], flat: string): string {
  if (sc.flat) return flat;
  if (v <= sc.s0) return ramp[0];
  if (v >= sc.s2) return ramp[2];
  return v <= sc.s1 ? mixHex(ramp[0], ramp[1], (v - sc.s0) / (sc.s1 - sc.s0)) : mixHex(ramp[1], ramp[2], (v - sc.s1) / (sc.s2 - sc.s1));
}

const radius = (extra: number): ExpressionSpecification => ["interpolate", ["exponential", 2], ["zoom"], 10, 1.2 + extra, 18, 16 + extra];

function applyData(map: MlMap, cells: Cell[], sc: Scale, ramp: string[], flat: string, halo: string, selected: string | null) {
  for (const id of ["cells-sel", "cells"]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource("cells")) map.removeSource("cells");
  if (!cells.length) return;

  map.addSource("cells", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: cells.map((c) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [c.lon, c.lat] },
        properties: { cid: c.id, rri: c.rri },
      })),
    },
  });
  const color: string | ExpressionSpecification = sc.flat
    ? flat
    : ["interpolate", ["linear"], ["get", "rri"], sc.s0, ramp[0], sc.s1, ramp[1], sc.s2, ramp[2]];
  map.addLayer({
    id: "cells",
    type: "circle",
    source: "cells",
    paint: { "circle-radius": radius(0), "circle-color": color, "circle-opacity": 0.92, "circle-blur": 0.35 },
  });
  map.addLayer({
    id: "cells-sel",
    type: "circle",
    source: "cells",
    filter: ["==", ["get", "cid"], selected ?? ""],
    paint: { "circle-radius": radius(4), "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 2.5, "circle-stroke-color": halo },
  });
}

export default function MapPage() {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const fitted = useRef(false);
  const selectedRef = useRef<string | null>(null);

  const [data, setData] = useState<CellsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [styleVersion, setStyleVersion] = useState(0);
  const [palette, setPalette] = useState({ ramp: ["#3b82c4", "#f28f3b", "#b3123f"], flat: "#8a96a3", halo: "#13202b" });

  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    setPalette({ ramp: [v("--r0"), v("--r1"), v("--r2")], flat: v("--flat"), halo: v("--halo") });
  }, []);

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  // Create the map once.
  useEffect(() => {
    let disposed = false;
    let map: MlMap | null = null;
    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (disposed || !canvasRef.current) return;
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      map = new maplibregl.Map({
        container: canvasRef.current,
        style: dark ? DARK_STYLE : LIGHT_STYLE,
        center: DEFAULT_CENTER,
        zoom: 11,
        attributionControl: { compact: true },
      });
      const m = map;
      mapRef.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      m.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");

      let fellBack = false;
      m.on("error", () => {
        if (!fellBack && !m.isStyleLoaded()) {
          fellBack = true; // the vector style could not load: use plain OpenStreetMap tiles
          m.setStyle(OSM_STYLE);
        }
      });
      m.on("style.load", () => setStyleVersion((n) => n + 1));
      m.on("click", (e) => {
        if (!m.getLayer("cells")) return;
        const { x, y } = e.point;
        const hits = m.queryRenderedFeatures([[x - 10, y - 10], [x + 10, y + 10]], { layers: ["cells"] });
        const cid = hits[0]?.properties?.cid as string | undefined;
        setSelected(cid ?? null);
        if (cid) setOpen(true);
      });
      m.on("mousemove", (e) => {
        if (!m.getLayer("cells")) return;
        m.getCanvas().style.cursor = m.queryRenderedFeatures(e.point, { layers: ["cells"] }).length ? "pointer" : "";
      });
    })();
    return () => {
      disposed = true;
      mapRef.current = null;
      map?.remove();
    };
  }, []);

  const scale = useMemo(() => makeScale(data?.cells ?? []), [data]);

  // Draw data whenever it, the palette or the basemap style changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data || styleVersion === 0) return;
    applyData(map, data.cells, scale, palette.ramp, palette.flat, palette.halo, selectedRef.current);
    if (!fitted.current && data.cells.length) {
      fitted.current = true;
      let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
      for (const c of data.cells) {
        minLon = Math.min(minLon, c.lon); maxLon = Math.max(maxLon, c.lon);
        minLat = Math.min(minLat, c.lat); maxLat = Math.max(maxLat, c.lat);
      }
      map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: { top: 60, left: 60, right: 60, bottom: 220 }, maxZoom: 17, duration: 0 });
    }
  }, [data, scale, palette, styleVersion]);

  useEffect(() => {
    selectedRef.current = selected;
    const map = mapRef.current;
    if (map && map.getLayer("cells-sel")) map.setFilter("cells-sel", ["==", ["get", "cid"], selected ?? ""]);
  }, [selected, styleVersion]);

  const cells = data?.cells ?? [];
  const confirmed = cells.filter((c) => c.trips >= 2).length;
  const sel = useMemo(() => cells.find((c) => c.id === selected) ?? null, [cells, selected]);
  const roughest = useMemo(() => [...cells].sort((a, b) => b.rri - a.rri).slice(0, 5), [cells]);

  function flyTo(c: Cell) {
    setSelected(c.id);
    mapRef.current?.flyTo({ center: [c.lon, c.lat], zoom: 17, duration: 800 });
  }

  return (
    <div className="mapshell">
      <div className="mapcanvas" ref={canvasRef} />

      <section className={`panel${open ? " open" : ""}`} aria-label="Road roughness summary">
        <button className="grab" aria-expanded={open} aria-label={open ? "Show less" : "Show more"} onClick={() => setOpen((o) => !o)}>
          <span />
        </button>
        <div className="panel-body">
          <h1>Road roughness</h1>
          <p className="sub">Measured by phones on real trips.</p>

          {error && <div className="error">Could not load the map data. {error}</div>}
          {!data && !error && <p className="sub">Loading…</p>}

          {data && cells.length === 0 && (
            <div className="empty-state">
              <p><strong>No roads recorded yet</strong></p>
              <p>Mount a phone in a vehicle and drive a route. It appears here as soon as you upload it.</p>
              <Link className="btn" href="/record">Record the first trip</Link>
            </div>
          )}

          {data && cells.length > 0 && (
            <>
              <div className="nums">
                <div className="num"><b>{cells.length}</b><span>road cells</span></div>
                <div className="num"><b>{data.totalTrips}</b><span>{data.totalTrips === 1 ? "trip" : "trips"}</span></div>
                <div className="num"><b>{confirmed}</b><span>confirmed</span></div>
              </div>
              <div className="ramp" role="img" aria-label="Colour scale from smoother to rougher" />
              <div className="ramp-labels"><span>Smoother</span><span>Rougher</span></div>

              <div className="more-wrap">
                <div className="more-inner">
                  {sel && (
                    <div className="pick" aria-live="polite">
                      <span className={`badge ${sel.trips >= 2 ? "confirmed" : "pending"}`}>{sel.trips >= 2 ? "Confirmed" : "Needs a second trip"}</span>
                      <div className="big" style={{ color: colorFor(sel.rri, scale, palette.ramp, palette.flat) }}>{sel.rri.toFixed(2)}</div>
                      <p>Roughness index, relative to this map</p>
                      <p>Measured on {sel.trips} {sel.trips === 1 ? "trip" : "trips"}{sel.spread !== null ? `, varying by about ±${sel.spread.toFixed(2)}` : ""}</p>
                      <p>Average speed {sel.speedKph.toFixed(0)} km/h</p>
                    </div>
                  )}

                  <div className="places">
                    <h2>Roughest places</h2>
                    {roughest.map((c) => (
                      <button key={c.id} className="place" onClick={() => flyTo(c)}>
                        <i style={{ background: colorFor(c.rri, scale, palette.ramp, palette.flat) }} />
                        <span className="t">
                          <b>Near {c.lat.toFixed(4)}, {c.lon.toFixed(4)}</b>
                          <span>{c.trips} {c.trips === 1 ? "trip" : "trips"}</span>
                        </span>
                        <span className="v">{c.rri.toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                  <p className="fine">Colours compare roads in this data with each other. They are not an engineering grade. A cell is confirmed once two separate trips measured it.</p>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      <Link className="btn fab" href="/record">Record a trip</Link>
    </div>
  );
}
