import { cellOf, getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;
const MAX_SEGMENTS = 3000;

type Incoming = {
  tripId?: unknown;
  deviceClass?: unknown;
  rateHz?: unknown;
  segments?: unknown;
};

const bad = (message: string, status = 400) => Response.json({ error: message }, { status });

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return bad("Payload too large.", 413);

  let body: Incoming;
  try {
    body = JSON.parse(text) as Incoming;
  } catch {
    return bad("Invalid JSON.");
  }

  const tripId = body.tripId;
  if (typeof tripId !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(tripId)) return bad("tripId must be 8-64 letters, digits or dashes.");
  const deviceClass = body.deviceClass === "ios" || body.deviceClass === "android" ? body.deviceClass : "other";
  const rateHz = typeof body.rateHz === "number" && Number.isFinite(body.rateHz) && body.rateHz > 0 && body.rateHz < 1000 ? body.rateHz : null;
  if (!Array.isArray(body.segments) || body.segments.length < 1 || body.segments.length > MAX_SEGMENTS) {
    return bad(`segments must be an array of 1-${MAX_SEGMENTS} items.`);
  }

  const rows: { cellLat: number; cellLon: number; rri: number; speedKph: number; samples: number }[] = [];
  for (let i = 0; i < body.segments.length; i++) {
    const s = body.segments[i] as Record<string, unknown> | null;
    const lat = s?.lat;
    const lon = s?.lon;
    const rri = s?.rri;
    const speedKph = s?.speedKph;
    const samples = s?.samples;
    if (
      typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180 ||
      typeof rri !== "number" || !Number.isFinite(rri) || rri < 0 || rri > 50 ||
      typeof speedKph !== "number" || !Number.isFinite(speedKph) || speedKph < 5 || speedKph > 160 ||
      typeof samples !== "number" || !Number.isInteger(samples) || samples < 1 || samples > 100000
    ) {
      return bad(`Segment ${i} is invalid.`);
    }
    const { cellLat, cellLon } = cellOf(lat, lon); // location is reduced to a ~22 m grid cell here
    rows.push({ cellLat, cellLon, rri, speedKph, samples });
  }

  const db = getDb();
  const exists = db.prepare("SELECT 1 AS x FROM segments WHERE trip_id = ? LIMIT 1").get(tripId);
  if (exists) return bad("This trip was already uploaded.", 409);

  const day = new Date().toISOString().slice(0, 10); // server-side UTC day, never client time
  const insert = db.prepare(
    `INSERT INTO segments (trip_id, day, cell_lat, cell_lon, rri, speed_kph, samples, device_class, rate_hz)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec("BEGIN");
  try {
    for (const r of rows) insert.run(tripId, day, r.cellLat, r.cellLon, r.rri, r.speedKph, r.samples, deviceClass, rateHz);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return bad(err instanceof Error ? err.message : "Database error.", 500);
  }
  return Response.json({ ok: true, stored: rows.length });
}
