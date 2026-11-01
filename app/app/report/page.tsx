"use client";

import { useEffect, useState } from "react";

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
  error?: string;
};

export default function ReportPage() {
  const [groups, setGroups] = useState<string[] | null>(null);
  const [group, setGroup] = useState("");
  const [focus, setFocus] = useState("");
  const [area, setArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<ReportResponse | null>(null);

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
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group, focus, area }),
      });
      const json = (await res.json()) as ReportResponse;
      setOut(json);
    } catch (e) {
      setOut({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="content">
      <h1>AI road report</h1>
      <p className="lead">
        Two open-weight models work through Otari: an analyst runs code on the road data, then a writer turns its numbers into a plain report. Each community group has its own spending limit, enforced by Otari. You never need a key.
      </p>

      <div className="card">
        <label htmlFor="group">Community group (its budget pays for the report)</label>
        <select id="group" value={group} onChange={(e) => setGroup(e.target.value)} disabled={!groups || groups.length === 0}>
          {(groups ?? []).map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        {groups && groups.length === 0 && <p className="small muted">No community groups are set up on this server yet.</p>}
        <label htmlFor="area">City or area (optional, lets the analyst search the web for the responsible road agency)</label>
        <input id="area" type="text" value={area} onChange={(e) => setArea(e.target.value)} maxLength={60} placeholder="e.g. Lagos, Nigeria" />
        <label htmlFor="focus">Optional focus (max 200 characters)</label>
        <input id="focus" type="text" value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={200} placeholder="e.g. highlight clusters seen on 2 or more trips" />
        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={generate} disabled={busy || !group}>{busy ? "Generating…" : "Generate report"}</button>
        </div>
      </div>

      {out?.budget && (
        <div className="warn">
          <strong>This community group has used up its AI budget.</strong> Reports are paused until the budget resets or the group admin raises it. You can pick another group from the list.
        </div>
      )}
      {out?.error && !out.budget && !out.stage && <div className="error">{out.error}</div>}
      {out?.error && !out.budget && out.stage && (
        <div className="error">The report could not be generated right now. Please try again in a minute.</div>
      )}
      {out?.error && out.stage && (
        <details>
          <summary className="small muted">Technical details</summary>
          <pre className="report">{out.stage ? `Step: ${out.stage}\n` : ""}{out.error}</pre>
        </details>
      )}
      {out?.error && out.analysis && (
        <details>
          <summary className="small muted">Analyst findings (completed before the failure)</summary>
          <pre className="report">{out.analysis}</pre>
        </details>
      )}
      {out?.report && (
        <div className="card">
          <p className="small muted">
            Analyst: {out.analystModel}{out.fallbacks?.analyst ? " (fallback used)" : ""} · Writer: {out.writerModel}{out.fallbacks?.writer ? " (fallback used)" : ""} · analysed {out.cellsAnalysed} of {out.totalCells} cells{out.webSearch === true ? " · web search used" : out.webSearch === false ? " · web search was not available, report written without it" : ""}
          </p>
          <pre className="report">{out.report}</pre>
          {out.analysis && (
            <details>
              <summary className="small muted">Analyst findings (what the writer was given)</summary>
              <pre className="report">{out.analysis}</pre>
            </details>
          )}
          <p className="small muted">Generated by an AI model from aggregated data only. Check the “unconfirmed” flags before acting on any finding.</p>
        </div>
      )}
    </div>
  );
}
