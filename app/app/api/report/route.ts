import { loadCells } from "@/lib/cells";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds; the model may run code before answering

const SYSTEM_PROMPT = `You are a careful analyst writing a short road-condition report for a community group or road agency.
You receive aggregated, crowd-sourced phone-vibration data for road cells of about 22 m.
"rri" is a RELATIVE roughness index (higher = rougher). It is not an engineering standard such as IRI.
"trips" is how many independent trips measured that cell. "spread" is the standard deviation of the per-trip values (null when only one trip).
Each cell is [id, lat, lon, rri, trips, spread].

RULES
- Use ONLY the data provided. Never invent street names, places, causes or repair costs: you only have coordinates.
- Use the code execution tool to compute every statistic you quote (counts, percentiles, ranking, clusters of cells within about 60 m of each other).
- Mark any finding that rests on cells with trips < 2 as UNCONFIRMED.
- State the limits of the data.

OUTPUT
1. Summary (3 sentences maximum)
2. Top hotspot clusters (list: centre lat/lon, number of cells, mean rri, trips range)
3. Data quality notes`;

function cleanLabel(v: string | null): string {
  const s = (v ?? "").replace(/[^A-Za-z0-9 _.-]/g, "").trim().slice(0, 40);
  return s || "anonymous";
}

async function callOtari(base: string, key: string, model: string, member: string, userContent: string) {
  return fetch(`${base.replace(/\/$/, "")}/api/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      tools: [{ type: "otari_code_execution" }],
      metadata: { app: "wildroads", member }, // tags: the ledger groups spend by "member"
    }),
    signal: AbortSignal.timeout(120000),
  });
}

export async function POST(req: Request) {
  const base = process.env.OTARI_BASE_URL;
  const model = process.env.OTARI_MODEL;
  if (!base || !model) {
    return Response.json({ error: "OTARI_BASE_URL and OTARI_MODEL must be set on the server (e.g. OTARI_MODEL=openai:gpt-4o-mini)." }, { status: 503 });
  }
  const key = req.headers.get("x-otari-key");
  if (!key) return Response.json({ error: "Missing x-otari-key header: paste your Otari virtual key." }, { status: 401 });
  const member = cleanLabel(req.headers.get("x-member"));

  let focus = "";
  try {
    const body = (await req.json()) as { focus?: unknown };
    if (typeof body.focus === "string") focus = body.focus.slice(0, 200);
  } catch {
    /* body is optional */
  }

  let loaded: Awaited<ReturnType<typeof loadCells>>;
  try {
    loaded = await loadCells();
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Could not read road data." }, { status: 500 });
  }
  const { cells, totalSegments, totalTrips } = loaded;
  if (cells.length === 0) {
    return Response.json({ error: "No road data has been uploaded yet. Record a trip first." }, { status: 409 });
  }
  const top = [...cells].sort((a, b) => b.rri - a.rri).slice(0, 600);
  const payload = {
    cellSizeM: 22,
    totalCells: cells.length,
    cellsShown: top.length,
    totalSegments,
    totalTrips,
    focus: focus || null,
    cells: top.map((c) => [c.id, +c.lat.toFixed(5), +c.lon.toFixed(5), +c.rri.toFixed(3), c.trips, c.spread === null ? null : +c.spread.toFixed(3)]),
  };
  const userContent = JSON.stringify(payload);

  const tryCall = async (m: string): Promise<Response | Error> => {
    try {
      return await callOtari(base, key, m, member, userContent);
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  };

  let usedModel = model;
  let usedFallback = false;
  let attempt = await tryCall(model);
  const fallback = process.env.OTARI_FALLBACK_MODEL;
  if (fallback && (attempt instanceof Error || attempt.status >= 500)) {
    attempt = await tryCall(fallback);
    usedModel = fallback;
    usedFallback = true;
  }
  if (attempt instanceof Error) {
    return Response.json({ error: `Could not reach Otari: ${attempt.message}` }, { status: 502 });
  }
  const res = attempt;

  const raw = await res.text();
  if (!res.ok) {
    // Budget and key errors come straight from Otari; show them as they are.
    return Response.json({ error: `Otari returned ${res.status}: ${raw.slice(0, 500)}` }, { status: res.status === 401 || res.status === 403 || res.status === 429 ? res.status : 502 });
  }
  let content: string | null = null;
  try {
    const json = JSON.parse(raw) as { choices?: { message?: { content?: unknown } }[] };
    const c = json.choices?.[0]?.message?.content;
    if (typeof c === "string") content = c;
  } catch {
    /* handled below */
  }
  if (!content) return Response.json({ error: `Unexpected Otari response: ${raw.slice(0, 300)}` }, { status: 502 });
  return Response.json({ report: content, model: usedModel, usedFallback, cellsAnalysed: top.length, totalCells: cells.length });
}
