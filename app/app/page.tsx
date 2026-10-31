"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

type Cell = { id: string; lat: number; lon: number; rri: number; trips: number; spread: number | null; speedKph: number };
type CellsResponse = { cells: Cell[]; totalSegments: number; totalTrips: number };

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
}

export default function MapPage() {
  const [data, setData] = useState<CellsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cells", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return (await r.json()) as CellsResponse;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasData = !!data && data.cells.length > 0;

  useEffect(() => {
    if (!data || !data.cells.length || !containerRef.current) return;
    let map: import("maplibre-gl").Map | null = null;
    let disposed = false;

    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (disposed || !containerRef.current) return;

      const sorted = data.cells.map((c) => c.rri).sort((a, b) => a - b);
      const p50 = quantile(sorted, 0.5);
      let p90 = quantile(sorted, 0.9);
      if (p90 <= p50) p90 = p50 + 1e-6; // step stops must be strictly ascending

      const geojson = {
        type: "FeatureCollection" as const,
        features: data.cells.map((c) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [c.lon, c.lat] },
          properties: { rri: c.rri, trips: c.trips, spread: c.spread, speed: c.speedKph },
        })),
      };

      let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
      for (const c of data.cells) {
        minLon = Math.min(minLon, c.lon); maxLon = Math.max(maxLon, c.lon);
        minLat = Math.min(minLat, c.lat); maxLat = Math.max(maxLat, c.lat);
      }

      map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors",
            },
          },
          layers: [{ id: "osm", type: "raster", source: "osm" }],
        },
        center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
        zoom: 14,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        if (!map) return;
        map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 48, maxZoom: 17, duration: 0 });
        map.addSource("cells", { type: "geojson", data: geojson });
        map.addLayer({
          id: "cells",
          type: "circle",
          source: "cells",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 6, 18, 12],
            "circle-color": ["step", ["get", "rri"], "#2e7d32", p50, "#f9a825", p90, "#c62828"],
            "circle-opacity": 0.85,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.on("click", "cells", (e) => {
          const f = e.features?.[0];
          if (!f || !map) return;
          const p = f.properties as { rri: number; trips: number; spread: number | null | string; speed: number };
          const spread = p.spread === null || p.spread === "null" || p.spread === undefined ? "n/a (1 trip)" : Number(p.spread).toFixed(2);
          new maplibregl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(`<strong>RRI ${Number(p.rri).toFixed(2)}</strong><br/>${p.trips} trip(s) · spread ${spread}<br/>avg ${Number(p.speed).toFixed(0)} km/h`)
            .addTo(map);
        });
        map.on("mouseenter", "cells", () => { if (map) map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "cells", () => { if (map) map.getCanvas().style.cursor = ""; });
      });
    })();

    return () => {
      disposed = true;
      map?.remove();
    };
  }, [data]);

  return (
    <>
      <h1>Road roughness map</h1>
      <p className="lead">Built from real phone vibration data uploaded by contributors. Locations are rounded to a ~22 m grid.</p>

      {error && <div className="error">Could not load data: {error}</div>}
      {!data && !error && <p className="muted">Loading…</p>}

      {data && (
        <div className="grid">
          <div className="stat"><div className="k">Cells</div><div className="v">{data.cells.length}</div></div>
          <div className="stat"><div className="k">Segments</div><div className="v">{data.totalSegments}</div></div>
          <div className="stat"><div className="k">Trips</div><div className="v">{data.totalTrips}</div></div>
          <div className="stat"><div className="k">Confirmed cells</div><div className="v">{data.cells.filter((c) => c.trips >= 2).length}</div></div>
        </div>
      )}

      {data && !hasData && (
        <div className="empty" style={{ marginTop: 12 }}>
          <p><strong>No road data yet.</strong></p>
          <p>Nothing is shown until someone records a real trip.</p>
          <a className="btn" href="/record">Record a trip</a>
        </div>
      )}

      {hasData && (
        <>
          <div className="legend" style={{ marginTop: 12 }}>
            <span><i style={{ background: "#2e7d32" }} />smoother half</span>
            <span><i style={{ background: "#f9a825" }} />middle 40%</span>
            <span><i style={{ background: "#c62828" }} />roughest 10%</span>
            <span>Colours are relative to the data on this map, not an engineering grade.</span>
          </div>
          <div id="map" ref={containerRef} />
          <p className="small muted">“Confirmed” means a cell was measured on at least 2 independent trips. Tap a dot for its trip count and spread between trips.</p>
        </>
      )}
    </>
  );
}
