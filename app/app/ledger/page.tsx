"use client";

import { useEffect, useState } from "react";

type LedgerResponse = { upstreamStatus?: number; data?: unknown; error?: string; hosted?: boolean };

export default function LedgerPage() {
  const [out, setOut] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ledger", { cache: "no-store" })
      .then(async (r) => (await r.json()) as LedgerResponse)
      .then((j) => !cancelled && setOut(j))
      .catch((e: unknown) => !cancelled && setOut({ error: e instanceof Error ? e.message : String(e) }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const byTag =
    out && typeof out.data === "object" && out.data !== null && "by_tag" in out.data
      ? ((out.data as { by_tag?: unknown }).by_tag as unknown)
      : undefined;

  return (
    <div className="content">
      <h1>Usage ledger</h1>
      <p className="lead">AI spend per community group. Nothing on this page is computed or estimated by this app.</p>

      {loading && <p className="muted">Loading…</p>}
      {out?.error && <div className="error">{out.error}</div>}

      {out?.hosted && (
        <div className="card">
          <p>Spend for each community group is enforced and shown by Otari itself, so this app does not repeat it.</p>
          <p className="small muted">
            Open the <a href="https://otari.ai/dashboard/" target="_blank" rel="noreferrer">Otari dashboard</a>: <b>Spend &amp; budgets</b> shows each group&rsquo;s limit and what it has spent, and the <b>Usage</b> tab shows which model served each request.
          </p>
        </div>
      )}

      {out && !out.error && !out.hosted && (
        <div className="card">
          <p className="small muted">Otari responded with status {out.upstreamStatus}.</p>
          {byTag && typeof byTag === "object" && !Array.isArray(byTag) ? (
            <table>
              <thead><tr><th>Member</th><th>Spend</th></tr></thead>
              <tbody>
                {Object.entries(byTag as Record<string, unknown>).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k === "null" ? "(untagged)" : k}</td>
                    <td>{typeof v === "object" ? JSON.stringify(v) : String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <>
              <p className="small muted">Showing Otari’s response as returned.</p>
              <pre className="raw">{typeof out.data === "string" ? out.data : JSON.stringify(out.data, null, 2)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
