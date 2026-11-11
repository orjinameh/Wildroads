"use client";

import { useEffect, useMemo, useState } from "react";
import { DAYPARTS, DAYPART_HOURS } from "@/lib/traffic";
import { Markdown } from "./markdown";

type ReportResponse = {
  report?: string;
  analysis?: string;
  analystModel?: string;
  writerModel?: string;
  fallbacks?: { analyst: boolean; writer: boolean };
  stage?: string;
  budget?: boolean;
  webSearch?: boolean | null;
  cellsAnalysed?: number;
  totalCells?: number;
  totals?: { trips: number; cells: number; firstDay: string | null; lastDay: string | null };
  error?: string;
};

type Facts = {
  cells: number | null;
  trips: number | null;
  confirmed: number | null;
  first: string | null;
  last: string | null;
  speeds: (number | null)[];
  tripsBy: (number | null)[];
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Reads the analyst's JSON for the summary tiles. Anything missing is simply left out; nothing is invented.
function readFacts(analysis: string | undefined): Facts | null {
  if (!analysis) return null;
  const t = analysis.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    const j = JSON.parse(t) as Record<string, any>;
    const byPart = (o: unknown) => [0, 1, 2, 3].map((i) => num((o as Record<string, unknown> | undefined)?.[String(i)]));
    return {
      cells: num(j.overall?.cells),
      trips: num(j.overall?.trips) ?? num(j.data_window?.trips),
      confirmed: num(j.overall?.confirmed_cells),
      first: typeof j.data_window?.first_trip_day === "string" ? j.data_window.first_trip_day : null,
      last: typeof j.data_window?.last_trip_day === "string" ? j.data_window.last_trip_day : null,
      speeds: byPart(j.traffic?.mean_speed_by_daypart),
      tripsBy: byPart(j.traffic?.trips_by_daypart),
    };
  } catch {
    return null;
  }
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim()), null, 2);
  } catch {
    return s;
  }
}

export default function ReportPage() {
  const [groups, setGroups] = useState<string[] | null>(null);
  const [group, setGroup] = useState("");
  const [focus, setFocus] = useState("");
  const [area, setArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<ReportResponse | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/report", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ groups?: string[] }>)
      .then((j) => {
        const g = j.groups ?? [];
        setGroups(g);
        let saved = "";
        try {
          saved = localStorage.getItem("wildroads.group") ?? "";
        } catch {
          /* storage unavailable: ignore */
        }
        setGroup(g.includes(saved) ? saved : (g[0] ?? ""));
      })
      .catch(() => setGroups([]));
  }, []);

  async function generate() {
    setBusy(true);
    setOut(null);
    try {
      try {
        localStorage.setItem("wildroads.group", group);
      } catch {
        /* ignore */
      }
      const res = await fetch("/api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ group, focus, area }) });
      setOut((await res.json()) as ReportResponse);
    } catch (e) {
      setOut({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!out?.report) return;
    try {
      await navigator.clipboard.writeText(out.report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  const facts = useMemo(() => readFacts(out?.analysis), [out?.analysis]);
  const anySpeed = facts?.speeds.some((s) => s !== null) ?? false;
  const friendly = out?.error && !out.budget && out.stage ? "The report could not be generated right now. Please try again in a minute." : out?.error && !out.budget ? out.error : null;

  return (
    <div className="r-page">
      <header className="r-hero">
        <p className="r-kicker">AI road report</p>
        <h1>What do the roads say?</h1>
        <p>An analyst model runs code on the road data, then a writer model turns its numbers into a short report you can send to a road agency. Each community group has its own spending limit, so you never need a key.</p>
      </header>

      <section className="r-card" aria-label="Report settings">
        <h2 className="r-label" id="g-label">Community group <span>its budget pays for the report</span></h2>
        <div className="r-chips" role="radiogroup" aria-labelledby="g-label">
          {groups === null && <span className="r-muted">Loading…</span>}
          {groups && groups.length === 0 && <span className="r-muted">No community groups are set up on this server yet.</span>}
          {(groups ?? []).map((g) => (
            <button key={g} role="radio" aria-checked={group === g} onClick={() => setGroup(g)}>{g}</button>
          ))}
        </div>

        <label className="r-label" htmlFor="area">City or area <span>optional, lets the analyst find the road agency</span></label>
        <input id="area" type="text" value={area} onChange={(e) => setArea(e.target.value)} maxLength={60} placeholder="e.g. Lagos, Nigeria" />

        <details className="r-more">
          <summary>Add a focus</summary>
          <input id="focus" aria-label="Optional focus" type="text" value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={200} placeholder="e.g. highlight stretches seen on 2 or more trips" />
        </details>

        <button className="r-go" onClick={generate} disabled={busy || !group}>{busy ? "Working…" : "Generate report"}</button>
        {busy && <p className="r-busy" role="status"><span className="r-spin" aria-hidden="true" />The analyst is running code and the writer follows. This can take up to a minute.</p>}
      </section>

      {out?.budget && (
        <div className="r-alert warn">
          {/member has exceeded/i.test(out.error ?? "") ? (
            <>
              <strong>The person who owns this group&rsquo;s key has reached their personal spending limit.</strong> Otari enforces a ceiling per member, on top of each group&rsquo;s own budget. It resets on its schedule, or an admin can raise it. Pick another group above.
            </>
          ) : (
            <>
              <strong>This community group has used up its AI budget.</strong> Reports are paused until the budget resets or the group admin raises it. Pick another group above.
            </>
          )}
        </div>
      )}
      {friendly && <div className="r-alert err">{friendly}</div>}
      {out?.error && out.stage && (
        <details className="r-tech">
          <summary>Technical details</summary>
          <pre>{`Step: ${out.stage}\n${out.error}`}</pre>
        </details>
      )}
      {out?.error && out.analysis && (
        <details className="r-tech">
          <summary>Analyst findings (completed before the failure)</summary>
          <pre>{prettyJson(out.analysis)}</pre>
        </details>
      )}

      {out?.report && (
        <article className="r-result" aria-label="Generated report">
          <div className="r-meta">
            <span className="r-tag">Analyst · {out.analystModel}{out.fallbacks?.analyst ? " (fallback)" : ""}</span>
            <span className="r-tag">Writer · {out.writerModel}{out.fallbacks?.writer ? " (fallback)" : ""}</span>
            {out.webSearch === true && <span className="r-tag on">Web search used</span>}
            {out.webSearch === false && <span className="r-tag">No web search</span>}
          </div>

          {facts && (
            <div className="r-tiles">
              {facts.cells !== null && <div><b>{facts.cells}</b><span>road cells</span></div>}
              {facts.trips !== null && <div><b>{facts.trips}</b><span>{facts.trips === 1 ? "trip" : "trips"}</span></div>}
              {facts.confirmed !== null && <div><b>{facts.confirmed}</b><span>confirmed cells</span></div>}
              {facts.first && <div><b>{facts.first === facts.last || !facts.last ? facts.first : `${facts.first} → ${facts.last}`}</b><span>trip days (UTC)</span></div>}
            </div>
          )}

          {anySpeed && facts && (
            <div className="r-speeds">
              <h2 className="r-label">Typical speed by time of day <span>average over past trips, not live traffic</span></h2>
              <div className="r-bars">
                {DAYPARTS.map((d, i) => {
                  const v = facts.speeds[i];
                  return (
                    <div key={d} title={DAYPART_HOURS[i]}>
                      <b>{v === null ? "–" : Math.round(v)}</b>
                      <span className="r-track"><span className={v !== null && v < 15 ? "slow" : ""} style={{ height: v === null ? "0%" : `${Math.max(6, Math.min(100, (v / 60) * 100))}%` }} /></span>
                      <em>{d}</em>
                      <small>{v === null ? "no data" : facts.tripsBy[i] ? `${facts.tripsBy[i]} ${facts.tripsBy[i] === 1 ? "trip" : "trips"}` : "km/h"}</small>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <Markdown text={out.report} />

          <div className="r-actions">
            <button className="secondary" onClick={copy}>{copied ? "Copied" : "Copy report"}</button>
          </div>
          <p className="r-muted">Analysed {out.cellsAnalysed} of {out.totalCells} cells. Generated by AI models from aggregated data only. Check the unconfirmed flags before acting on any finding.</p>

          {out.analysis && (
            <details className="r-tech">
              <summary>Analyst findings (what the writer was given)</summary>
              <pre>{prettyJson(out.analysis)}</pre>
            </details>
          )}
        </article>
      )}
    </div>
  );
}
