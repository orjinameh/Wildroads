import { loadCells } from "@/lib/cells";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds; the model may run code before answering

const ANALYST_PROMPT = `You are the ANALYST in a two-step road-report pipeline. A separate writer model will turn your output into the final report, so output facts, not prose.
You receive aggregated, crowd-sourced phone-vibration data for road cells of about 22 m.
"rri" is a RELATIVE roughness index (higher = rougher). It is not an engineering standard such as IRI.
"trips" is how many independent trips measured that cell. "spread" is the standard deviation of the per-trip values (null when only one trip).
Each cell is [id, lat, lon, rri, trips, spread].

RULES
- Use ONLY the data provided. Never invent street names, places, causes or repair costs: you only have coordinates.
- Use the code execution tool to compute every number (counts, percentiles, ranking, clusters of cells within about 60 m of each other). Do not estimate by eye.
- A finding that rests on cells with trips < 2 is UNCONFIRMED.

OUTPUT (compact JSON only, no markdown):
{"overall":{"cells":n,"trips":n,"median_rri":x,"p90_rri":x,"confirmed_cells":n},
 "clusters":[{"lat":x,"lon":x,"cells":n,"mean_rri":x,"min_trips":n,"max_trips":n,"confirmed":true|false}],
 "limits":["..."]}
Return at most 8 clusters, roughest first.`;

const WRITER_PROMPT = `You are the WRITER in a two-step road-report pipeline. You receive the analyst's computed findings as JSON. You have no other data and no tools.
Write a short road-condition report for a community group or road agency, in plain language.

RULES
- Use ONLY numbers that appear in the findings. Never add or change a number, and never invent places, causes or costs.
- Say "relative roughness", never imply an engineering standard.
- Label clusters with confirmed=false as UNCONFIRMED and say a single trip is not enough to act on.
- If the findings look empty or inconsistent, say so rather than filling in.

OUTPUT
1. Summary (3 sentences maximum)
2. Top hotspot clusters (list: centre lat/lon, number of cells, mean roughness, trips)
3. What this data cannot tell you`;

function cleanLabel(v: string | null): string {
  const s = (v ?? "").replace(/[^A-Za-z0-9 _.-]/g, "").trim().slice(0, 40);
  return s || "anonymous";
}

// Hosted platform: OTARI_BASE_URL = https://api.otari.ai/v1  -> {base}/chat/completions
// Self-hosted gateway: OTARI_BASE_URL = https://your-host     -> {base}/api/v1/chat/completions
function chatUrl(base: string): string {
  const b = base.replace(/\/+$/, "");
  return /\/v1$/.test(b) ? `${b}/chat/completions` : `${b}/api/v1/chat/completions`;
}

async function callOtari(base: string, key: string, model: string, member: string, role: "analyst" | "writer", system: string, userContent: string) {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    metadata: { app: "wildroads", member, role }, // tags: usage can be grouped by member and by role
  };
  if (role === "analyst") body.tools = [{ type: "otari_code_execution" }]; // only the analyst runs code
  return fetch(chatUrl(base), {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(role === "analyst" ? 90000 : 40000),
  });
}

type Stage = { content: string; model: string; fellBack: boolean } | { error: string; status: number };

export async function POST(req: Request) {
  const base = process.env.OTARI_BASE_URL;
  const analystModel = process.env.OTARI_MODEL;
  const writerModel = process.env.OTARI_WRITER_MODEL || process.env.OTARI_FALLBACK_MODEL;
  if (!base || !analystModel || !writerModel) {
    return Response.json({ error: "OTARI_BASE_URL, OTARI_MODEL (analyst) and OTARI_WRITER_MODEL must be set on the server (model ids exactly as shown in the Otari Models tab)." }, { status: 503 });
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

  // One stage: try the primary model; on a network error or 5xx, try the other model once.
  const runStage = async (role: "analyst" | "writer", system: string, user: string, primary: string, alt: string): Promise<Stage> => {
    const attempt = async (m: string): Promise<Response | Error> => {
      try {
        return await callOtari(base, key, m, member, role, system, user);
      } catch (err) {
        return err instanceof Error ? err : new Error(String(err));
      }
    };
    let used = primary;
    let fellBack = false;
    let r = await attempt(primary);
    if (alt && alt !== primary && (r instanceof Error || r.status >= 500)) {
      r = await attempt(alt);
      used = alt;
      fellBack = true;
    }
    if (r instanceof Error) return { error: `Could not reach Otari (${role}): ${r.message}`, status: 502 };
    const raw = await r.text();
    if (!r.ok) {
      // Budget and key errors come straight from Otari; show them as they are.
      const pass = r.status === 401 || r.status === 403 || r.status === 429;
      return { error: `Otari returned ${r.status} (${role}): ${raw.slice(0, 500)}`, status: pass ? r.status : 502 };
    }
    let content: string | null = null;
    try {
      const json = JSON.parse(raw) as { choices?: { message?: { content?: unknown } }[] };
      const c = json.choices?.[0]?.message?.content;
      if (typeof c === "string" && c.trim()) content = c;
    } catch {
      /* handled below */
    }
    if (!content) return { error: `Unexpected Otari response (${role}): ${raw.slice(0, 300)}`, status: 502 };
    return { content, model: used, fellBack };
  };

  const analysis = await runStage("analyst", ANALYST_PROMPT, JSON.stringify(payload), analystModel, writerModel);
  if ("error" in analysis) return Response.json({ error: analysis.error, stage: "analyst" }, { status: analysis.status });

  const writing = await runStage("writer", WRITER_PROMPT, analysis.content, writerModel, analystModel);
  if ("error" in writing) return Response.json({ error: writing.error, stage: "writer", analysis: analysis.content, analystModel: analysis.model }, { status: writing.status });

  return Response.json({
    report: writing.content,
    analysis: analysis.content,
    analystModel: analysis.model,
    writerModel: writing.model,
    fallbacks: { analyst: analysis.fellBack, writer: writing.fellBack },
    cellsAnalysed: top.length,
    totalCells: cells.length,
  });
}
