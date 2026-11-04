"use client";

// Interface pieces of the map screen. Pure presentation: the map itself and the data live in page.tsx.

import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { BrandMark } from "./nav";
import { DAYPARTS, DAYPART_HOURS } from "@/lib/traffic";
import type { Level } from "@/lib/level";
import { cachedPlace, formatCoord, resolvePlace } from "@/lib/place";

export type Mode = "roughness" | "traffic";
export type Band = { daypart: number; n: number; speedKph: number };
export type Stretch = {
  id: string;
  lat: number;
  lon: number;
  lengthM: number;
  v: number; // value that drives colour (roughness index, or "slowness" for traffic)
  trips: number; // typical number of independent trips on this stretch (median over its cells)
  speedKph: number;
  spread: number | null;
  bands: Band[];
};

export const tripsText = (n: number) => `${n} ${n === 1 ? "trip" : "trips"}`;

export function lengthText(m: number): string {
  if (m < 1000) return `${Math.max(20, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/* ---------- small hooks ---------- */

export function useCountUp(target: number, ms = 850): number {
  const [v, setV] = useState(typeof window === "undefined" ? target : 0);
  const prev = useRef(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      prev.current = target;
      setV(target);
      return;
    }
    let raf = 0;
    const from = prev.current;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(from + (target - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
      else prev.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function usePlaceName(lat: number, lon: number): string {
  const [name, setName] = useState<string | null>(() => (typeof window === "undefined" ? null : cachedPlace(lat, lon)));
  useEffect(() => {
    let off = false;
    const hit = cachedPlace(lat, lon);
    setName(hit);
    if (!hit) {
      resolvePlace(lat, lon).then((n) => {
        if (!off && n) setName(n);
      });
    }
    return () => {
      off = true;
    };
  }, [lat, lon]);
  return name ?? `Near ${formatCoord(lat, lon)}`;
}

export function PlaceName({ lat, lon }: { lat: number; lon: number }) {
  return <>{usePlaceName(lat, lon)}</>;
}

/* ---------- icons ---------- */

const ic = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...ic} aria-hidden="true">
    {children}
  </svg>
);
const PART_ICONS: ReactNode[] = [
  <Icon key="n"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" /></Icon>,
  <Icon key="m"><path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 6v3M4.9 10.9l1.8 1.1M19.1 10.9 17.3 12" /></Icon>,
  <Icon key="d"><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></Icon>,
  <Icon key="e"><path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 4v3M4.9 8.9l1.8 1.1M19.1 8.9 17.3 10M2 14h2M20 14h2" /></Icon>,
];

/* ---------- top bar: brand, layer switch, help, time of day ---------- */

export function TopBar(props: {
  mode: Mode;
  onMode: (m: Mode) => void;
  part: number;
  onPart: (p: number) => void;
  hasTraffic: boolean;
  onHelp: () => void;
}) {
  const { mode, onMode, part, onPart, hasTraffic, onHelp } = props;
  return (
    <header className="m-top">
      <div className="m-top-row">
        <span className="m-brand"><BrandMark size={34} /></span>
        <div className="m-switch" role="group" aria-label="Map layer" data-mode={mode}>
          <span className="m-thumb" aria-hidden="true" />
          <button aria-pressed={mode === "roughness"} onClick={() => onMode("roughness")}>Roughness</button>
          <button
            aria-pressed={mode === "traffic"}
            onClick={() => onMode("traffic")}
            disabled={!hasTraffic}
            title={hasTraffic ? undefined : "Traffic appears after the first trip is uploaded"}
          >
            Traffic
          </button>
        </div>
        <button className="m-round" aria-label="How to read this map" onClick={onHelp}>
          <svg viewBox="0 0 24 24" width="20" height="20" {...ic} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.6 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8M12 17h.01" /></svg>
        </button>
      </div>
      {mode === "traffic" && (
        <div className="m-chips" role="group" aria-label="Time of day">
          <button aria-pressed={part < 0} onClick={() => onPart(-1)}>Any time</button>
          {DAYPARTS.map((d, i) => (
            <button key={d} aria-pressed={part === i} onClick={() => onPart(i)} title={DAYPART_HOURS[i]}>
              {PART_ICONS[i]}
              {d}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}

/* ---------- bottom sheet (phones) / side panel (desktop) ---------- */

export function Sheet(props: { snap: 0 | 1 | 2; onSnap: (s: 0 | 1 | 2) => void; header: ReactNode; children: ReactNode }) {
  const { snap, onSnap, header, children } = props;
  const ref = useRef<HTMLElement | null>(null);
  const drag = useRef<{ y: number; visible: number; t: number; moved: boolean } | null>(null);
  const [offset, setOffset] = useState<number | null>(null);

  const phone = () => window.matchMedia("(max-width: 899px)").matches;
  const visibleNow = () => {
    const el = ref.current;
    return el && el.parentElement ? el.parentElement.getBoundingClientRect().bottom - el.getBoundingClientRect().top : 0;
  };

  function down(e: ReactPointerEvent<HTMLElement>) {
    if (!phone()) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, visible: visibleNow(), t: performance.now(), moved: false };
  }
  function move(e: ReactPointerEvent<HTMLElement>) {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 6) d.moved = true;
    const full = el.offsetHeight;
    setOffset(full - Math.min(full, Math.max(110, d.visible - dy)));
  }
  function up(e: ReactPointerEvent<HTMLElement>) {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d || !el) return;
    setOffset(null);
    if (!d.moved) return;
    const dy = e.clientY - d.y;
    const speed = dy / Math.max(1, performance.now() - d.t); // px per ms, downward positive
    const target = d.visible - dy - speed * 140;
    const snaps = [236, window.innerHeight * 0.52, el.offsetHeight];
    let best = 0;
    snaps.forEach((s, i) => {
      if (Math.abs(s - target) < Math.abs(snaps[best] - target)) best = i;
    });
    onSnap(best as 0 | 1 | 2);
  }
  function cycle() {
    if (drag.current?.moved) return;
    onSnap(snap === 0 ? 1 : snap === 1 ? 2 : 0);
  }

  return (
    <section
      ref={ref}
      className={`m-sheet snap-${snap}`}
      style={offset === null ? undefined : { transform: `translateY(${offset}px)`, transition: "none" }}
      aria-label="Road summary"
    >
      <div className="m-grab-zone" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <button className="m-grab" onClick={cycle} aria-label={snap === 2 ? "Show less" : "Show more"}>
          <span />
        </button>
      </div>
      <div className="m-head">{header}</div>
      <div className="m-body">{children}</div>
    </section>
  );
}

/* ---------- reading aids ---------- */

export function Meter({ pct, label }: { pct: number; label: string }) {
  const p = Math.min(100, Math.max(0, pct));
  return (
    <div className="m-meter" role="img" aria-label={label}>
      <span className="m-meter-knob" style={{ left: `${p}%` }} />
    </div>
  );
}

export function LevelPill({ level }: { level: Level }) {
  return <span className={`m-pill tone-${level.tone}`}>{level.label}</span>;
}

export function Legend({ mode }: { mode: Mode }) {
  return (
    <div className="m-legend">
      <div className="m-legend-bar" />
      <div className="m-legend-labels">
        <span>{mode === "traffic" ? "Flowing" : "Smoother"}</span>
        <span>{mode === "traffic" ? "Slow" : "Rougher"}</span>
      </div>
      <p>
        {mode === "traffic"
          ? "Colour is the speed our users drove. A dotted line means one trip so far."
          : "Colours compare the roads on this map with each other, not with a standard. A dotted line means one trip so far; it turns solid when a second trip confirms it."}
      </p>
    </div>
  );
}

function Num({ value, decimals = 0 }: { value: number; decimals?: number }) {
  return <>{useCountUp(value).toFixed(decimals)}</>;
}

/* ---------- sheet content: summary ---------- */

export function Summary(props: {
  mode: Mode;
  km: number;
  trips: number;
  confirmedPct: number;
  lead: { stretch: Stretch; level: Level | null; onOpen: () => void } | null;
  part: number;
}) {
  const { mode, km, trips, confirmedPct, lead, part } = props;
  const when = part >= 0 ? ` in the ${DAYPARTS[part].toLowerCase()}` : "";
  return (
    <>
      <div className="m-hero">
        <div>
          <div className="m-big">
            <Num value={km} decimals={km < 10 ? 1 : 0} />
            <small> km</small>
          </div>
          <div className="m-sub">{mode === "traffic" ? `of speeds measured${when}` : "of road measured so far"}</div>
        </div>
        <div className="m-facts">
          <span><b><Num value={trips} /></b> {trips === 1 ? "trip" : "trips"}</span>
          <span><b><Num value={confirmedPct} />%</b> confirmed</span>
        </div>
      </div>
      {lead && (
        <button className="m-lead" onClick={lead.onOpen}>
          <span className="m-lead-k">{mode === "traffic" ? "Slowest stretch" : "Roughest stretch"}</span>
          <span className="m-lead-n"><PlaceName lat={lead.stretch.lat} lon={lead.stretch.lon} /></span>
          <span className="m-lead-m">
            {lead.level && <LevelPill level={lead.level} />}
            <span>
              {mode === "traffic"
                ? `${Math.round(lead.stretch.speedKph)} km/h`
                : lead.level
                  ? `rougher than ${Math.round(lead.level.pct)}% of the map`
                  : "too few roads yet to compare"}
              {" · "}
              {tripsText(lead.stretch.trips)}
            </span>
          </span>
        </button>
      )}
    </>
  );
}

/* ---------- sheet content: ranked list ---------- */

export function StretchList(props: {
  title: string;
  rows: { stretch: Stretch; level: Level | null }[];
  mode: Mode;
  onOpen: (s: Stretch) => void;
}) {
  const { title, rows, mode, onOpen } = props;
  return (
    <div className="m-list">
      <h2>{title}</h2>
      {rows.map(({ stretch: s, level }, i) => (
        <button key={s.id} className="m-row" onClick={() => onOpen(s)}>
          <span className="m-rank">{i + 1}</span>
          <span className="m-row-main">
            <b><PlaceName lat={s.lat} lon={s.lon} /></b>
            <span>
              about {lengthText(s.lengthM)} · {tripsText(s.trips)}
              {mode === "traffic" ? ` · ${Math.round(s.speedKph)} km/h` : ""}
            </span>
          </span>
          {level && <LevelPill level={level} />}
        </button>
      ))}
    </div>
  );
}

/* ---------- sheet content: one stretch ---------- */

export function DaypartBars({ bands }: { bands: Band[] }) {
  return (
    <div className="m-bars" role="list" aria-label="Average speed by time of day">
      {DAYPARTS.map((d, i) => {
        const b = bands.find((x) => x.daypart === i);
        const kph = b ? b.speedKph : 0;
        const tone = !b ? "none" : kph < 8 ? "3" : kph < 15 ? "2" : kph < 30 ? "1" : "0";
        return (
          <div key={d} className="m-bar" role="listitem" title={DAYPART_HOURS[i]}>
            <span className="m-bar-v">{b ? `${Math.round(kph)}` : "–"}</span>
            <span className="m-bar-track">
              <span className={`m-bar-fill tone-${tone}`} style={{ height: b ? `${Math.max(6, Math.min(100, (kph / 60) * 100))}%` : "0%" }} />
            </span>
            <span className="m-bar-l">{PART_ICONS[i]}<span>{d}</span></span>
            <span className="m-bar-n">{b ? tripsText(b.n) : "no data"}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Detail(props: {
  mode: Mode;
  stretch: Stretch;
  level: Level | null;
  onBack: () => void;
  onShare: () => void;
  shared: string | null;
}) {
  const { mode, stretch: s, level, onBack, onShare, shared } = props;
  const agree = s.spread === null ? null : s.v > 0 && s.spread / s.v < 0.3 ? "Trips agree" : "Trips vary";
  return (
    <div className="m-detail" aria-live="polite">
      <button className="m-back" onClick={onBack}>
        <svg viewBox="0 0 24 24" width="18" height="18" {...ic} aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        All stretches
      </button>
      <h2><PlaceName lat={s.lat} lon={s.lon} /></h2>
      <div className="m-meta">
        {level && <LevelPill level={level} />}
        <span>about {lengthText(s.lengthM)}</span>
        <span>{tripsText(s.trips)}</span>
      </div>

      {mode === "roughness" ? (
        <>
          {level ? (
            <>
              <Meter pct={level.pct} label={`Rougher than ${Math.round(level.pct)} percent of the roads on this map`} />
              <p className="m-note">Rougher than {Math.round(level.pct)}% of the roads on this map.</p>
            </>
          ) : (
            <p className="m-note">The map has too few roads so far to say how this one compares.</p>
          )}
          <dl className="m-grid">
            <div><dt>Trips</dt><dd>{s.trips}</dd></div>
            <div><dt>Average speed</dt><dd>{Math.round(s.speedKph)} km/h</dd></div>
            <div><dt>Agreement</dt><dd>{agree ?? "One trip"}</dd></div>
          </dl>
          {s.speedKph < 20 && <p className="m-note">Measured at low speed, so this reading is less reliable.</p>}
        </>
      ) : (
        <>
          <DaypartBars bands={s.bands} />
          <p className="m-note">One trip cannot tell a jam from a red light or a parked car. Readings add up as more trips cover this road.</p>
        </>
      )}

      {s.trips < 2 && (
        <p className="m-confirm">
          <strong>Seen once.</strong> Drive this road again and it becomes a confirmed reading.
        </p>
      )}
      <div className="m-actions">
        <Link className="btn" href="/record">Drive it again</Link>
        <button className="btn secondary" onClick={onShare}>{shared ?? "Share this stretch"}</button>
      </div>
    </div>
  );
}

/* ---------- first visit, help, loading, error, empty ---------- */

export function Coach({ onClose }: { onClose: () => void }) {
  return (
    <aside className="m-coach" aria-label="Welcome">
      <p><strong>Phones can feel the road.</strong> Mount yours in a vehicle, drive a route, and it appears here as a road you helped measure.</p>
      <div className="m-coach-actions">
        <Link className="btn" href="/record">Record a trip</Link>
        <button className="btn secondary" onClick={onClose}>Got it</button>
      </div>
    </aside>
  );
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="m-modal" onClick={onClose}>
      <div className="m-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="help-title">How to read this map</h2>
        <ul>
          <li><b>Colour</b> compares the roads on this map with each other. It is not an engineering grade.</li>
          <li><b>Solid line</b> means two or more separate trips agree. <b>Dotted</b> means one trip so far.</li>
          <li><b>Traffic</b> shows the speeds our own users drove. It is not a full traffic feed.</li>
          <li><b>Privacy:</b> raw sensor data never leaves the phone. Only road summaries on a 22 m grid are shared, with no names or accounts, and the first and last 200 m of every trip are removed.</li>
        </ul>
        <button ref={closeRef} className="btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="m-skel" aria-busy="true" aria-label="Loading the map data">
      <span className="s1" />
      <span className="s2" />
      <span className="s3" />
      <span className="s3" />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="m-state" role="alert">
      <p><strong>The map data did not load.</strong></p>
      <p>{message}</p>
      <button className="btn" onClick={onRetry}>Try again</button>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="m-state">
      <p><strong>No roads on the map yet.</strong></p>
      <p>Mount a phone in a vehicle and drive any route. Your trip shows up here as soon as you upload it.</p>
      <Link className="btn" href="/record">Record the first trip</Link>
    </div>
  );
}
