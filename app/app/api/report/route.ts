import { loadCells } from "@/lib/cells";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds; the model may run code before answering

const ANALYST_PROMPT = `You are the ANALYST in a two-step road-report pipeline. A separate writer model will turn your output into the final report, so output facts, not prose.
You receive aggregated, crowd-sourced phone-vibration data for road cells of about 22 m.
"rri" is a RELATIVE roughness index (higher = rougher). It is not an engineering standard such as IRI.
"trips" is how many independent trips measured that cell. "spread" is the standard deviation of the per-trip values (null when only one trip).
Each cell is [id, lat, lon, rri, trips, spread].
"traffic" lists cells with speed observed by our own users: [id, lat, lon, [[daypart, trips, mean_speed_kph], ...]].
daypart 0=night 22-05h, 1=morning 05-11h, 2=midday 11-16h, 3=evening 16-22h (local time). A speed under 15 km/h counts as "slow".
This is NOT a full traffic feed: it only covers roads our users drove, so it says nothing about roads without readings.

RULES
- Use ONLY the data provided. Never invent street names, places, causes or repair costs: you only have coordinates.
- Use the code execution tool to compute every number (counts, percentiles, ranking, clusters of cells within about 60 m of each other). Do not estimate by eye.
- A finding that rests on cells with trips < 2 is UNCONFIRMED.
- If "area" is not null, use the web search tool to find which public agency is responsible for roads in that area and where it accepts reports. Only report a name and URL that appear in the search results. Prefer the agency's own official website (for example a .gov.ng domain); never use a social media post as the URL, and if only unofficial pages are found give the agency name with url null. If the area has both a state and a federal road agency, name the one for state and local roads. If you are not sure, use null. Never guess a phone number or email.

OUTPUT (compact JSON only, no markdown):
{"overall":{"cells":n,"trips":n,"median_rri":x,"p90_rri":x,"confirmed_cells":n},
 "clusters":[{"lat":x,"lon":x,"cells":n,"mean_rri":x,"min_trips":n,"max_trips":n,"confirmed":true|false}],
 "traffic":{"cells":n,"slow_cells_by_daypart":{"0":n,"1":n,"2":n,"3":n},"median_speed_by_daypart":{"0":x,"1":x,"2":x,"3":x},
   "slow_clusters":[{"lat":x,"lon":x,"cells":n,"mean_kph":x,"daypart":d,"min_trips":n}]},
 "agency":{"name":"...","url":"https://..."} or null,
 "limits":["..."]}
Use null where a daypart has no readings. Return at most 8 roughness clusters (roughest first) and at most 5 slow clusters (slowest first).`;

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
3. Who to send this to (only if the findings include an agency; use its name and url exactly as given, otherwise leave this section out)
4. Traffic (only if the findings contain speed readings; say which parts of the day have data and which have none)
5. What this data cannot tell you (always say traffic covers only roads our users drove, and that one trip cannot separate congestion from a red light or parked car)`;

function cleanLabel(v: string | null): string {
  const s = (v ?? "").replace(/[^A-Za-z0-9 _.-]/g, "").trim().slice(0, 40);
  return s || "anonymous";
}

// Hosted platform: OTARI_BASE_URL = https://eu.api.otari.ai/api/v1  -> {base}/chat/completions
// Self-hosted gateway: OTARI_BASE_URL = https://your-host     -> {base}/api/v1/chat/completions
function chatUrl(base: string): string {
  const b = base.replace(/\/+$/, "");
  return /\/v1$/.test(b) ? `${b}/chat/completions` : `${b}/api/v1/chat/completions`;
}

async function callOtari(base: string, key: string, model: string, member: string, role: "analyst" | "writer", system: string, userContent: string, webSearch: boolean) {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    metadata: { app: "wildroads", member, role }, // tags: usage can be grouped by member and by role
  };
  // Only the analyst gets tools: code execution always, web search when an area was given.
  if (role === "analyst") body.tools = webSearch ? [{ type: "otari_code_execution" }, { type: "otari_web_search" }] : [{ type: "otari_code_execution" }];
  return fetch(chatUrl(base), {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(role === "analyst" ? 100000 : 40000),
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
  let area = "";
  try {
    const body = (await req.json()) as { focus?: unknown; area?: unknown };
    if (typeof body.focus === "string") focus = body.focus.slice(0, 200);
    if (typeof body.area === "string") area = body.area.replace(/[^\p{L}\p{N} ,.'-]/gu, "").trim().slice(0, 60);
  } catch {
    /* body is optional */
  }

  let loaded: Awaited<ReturnType<typeof loadCells>>;
  try {
    loaded = await loadCells();
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Could not read road data." }, { status: 500 });
  }
  const { cells, traffic, totalSegments, totalTrips } = loaded;
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
    area: area || null,
    traffic: [...traffic]
      .sort((a, b) => Math.min(...a.bands.map((x) => x.speedKph)) - Math.min(...b.bands.map((x) => x.speedKph)))
      .slice(0, 300)
      .map((t) => [t.id, +t.lat.toFixed(5), +t.lon.toFixed(5), t.bands.map((b) => [b.daypart, b.n, +b.speedKph.toFixed(1)])]),
    cells: top.map((c) => [c.id, +c.lat.toFixed(5), +c.lon.toFixed(5), +c.rri.toFixed(3), c.trips, c.spread === null ? null : +c.spread.toFixed(3)]),
  };

  // One stage: try the primary model; on a network error or 5xx, try the other model once.
  let webSearchUsed = false;
  const runStage = async (role: "analyst" | "writer", system: string, user: string, primary: string, alt: string, wantSearch = false): Promise<Stage> => {
    let search = wantSearch;
    const attempt = async (m: string): Promise<Response | Error> => {
      try {
        return await callOtari(base, key, m, member, role, system, user, search);
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
    if (search && !r.ok && r.status !== 401 && r.status !== 402 && r.status !== 429 && /search/i.test(await r.clone().text())) {
      // The workspace, key or model refused the web search tool: retry once without it, and say so in the response.
      search = false;
      const again = await attempt(used);
      if (again instanceof Error) return { error: `Could not reach Otari (${role}): ${again.message}`, status: 502 };
      r = again;
    }
    if (role === "analyst") webSearchUsed = search;
    const raw = await r.text();
    if (!r.ok) {
      // Budget and key errors come straight from Otari; show them as they are.
      const pass = r.status === 401 || r.status === 402 || r.status === 403 || r.status === 429;
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

  const analysis = await runStage("analyst", ANALYST_PROMPT, JSON.stringify(payload), analystModel, writerModel, Boolean(area));
  if ("error" in analysis) return Response.json({ error: analysis.error, stage: "analyst", budget: analysis.status === 402 || analysis.status === 429 }, { status: analysis.status });

  const writing = await runStage("writer", WRITER_PROMPT, analysis.content, writerModel, analystModel);
  if ("error" in writing) return Response.json({ error: writing.error, stage: "writer", budget: writing.status === 402 || writing.status === 429, analysis: analysis.content, analystModel: analysis.model }, { status: writing.status });

  return Response.json({
    report: writing.content,
    analysis: analysis.content,
    analystModel: analysis.model,
    writerModel: writing.model,
    fallbacks: { analyst: analysis.fellBack, writer: writing.fellBack },
    webSearch: Boolean(area) ? webSearchUsed : null,
    cellsAnalysed: top.length,
    totalCells: cells.length,
  });
}
