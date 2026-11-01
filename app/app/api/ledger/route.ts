export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Spend per member, read from Otari's own usage API (documented: GET /api/v1/usage/summary?group_by_tag=<key>).
// The response schema is not documented, so the UI renders whatever comes back without reshaping it.
export async function GET() {
  const base = process.env.OTARI_BASE_URL;
  const master = process.env.OTARI_MASTER_KEY;
  if (!base) {
    return Response.json({ error: "OTARI_BASE_URL must be set on the server." }, { status: 503 });
  }
  let hosted = false;
  try {
    hosted = new URL(base).hostname.endsWith("otari.ai");
  } catch {
    /* not a URL: treated as self-hosted below */
  }
  if (hosted) {
    // The hosted usage endpoints answer "Invalid master key" to a normal API key, so the app cannot read spend itself.
    return Response.json({ hosted: true });
  }
  if (!master) {
    return Response.json({ error: "OTARI_BASE_URL and OTARI_MASTER_KEY must be set on the server." }, { status: 503 });
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/v1/usage/summary?group_by_tag=member`, {
      headers: { Authorization: `Bearer ${master}` },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return Response.json({ upstreamStatus: res.status, data }, { status: res.ok ? 200 : 502 });
  } catch (err) {
    return Response.json({ error: `Could not reach Otari: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
}
