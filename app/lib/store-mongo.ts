// MongoDB Atlas storage. Same data model and same results as the SQLite store.
//   trips:    one document per upload, _id = tripId (the unique _id makes duplicate uploads impossible)
//   segments: one document per ~22 m cell measurement; no identity, no timestamps beyond a UTC day
import { MongoClient } from "mongodb";
import { cellCenter } from "./grid";
import type { Cell, CellsResult, NewTrip, Store, TrafficCell } from "./types";

// Reuse one client across invocations of a serverless function instance.
const g = globalThis as unknown as { _wildroadsMongo?: Promise<MongoClient> };

export async function createMongoStore(uri: string): Promise<Store> {
  if (!g._wildroadsMongo) g._wildroadsMongo = new MongoClient(uri, { maxPoolSize: 5 }).connect();
  const client = await g._wildroadsMongo;
  const db = client.db(process.env.MONGODB_DB ?? "wildroads");
  const segments = db.collection("segments");
  const speeds = db.collection("speeds"); // every segment's speed (incl. slow ones), by part of day
  const trips = db.collection<{ _id: string; day: string; deviceClass: string; rateHz: number | null; segments: number }>("trips");

  await Promise.all([segments.createIndex({ tripId: 1 }), segments.createIndex({ cellLat: 1, cellLon: 1 }), speeds.createIndex({ tripId: 1 })]);

  return {
    async insertTrip(t: NewTrip) {
      try {
        await trips.insertOne({ _id: t.tripId, day: t.day, deviceClass: t.deviceClass, rateHz: t.rateHz, segments: t.rows.length });
      } catch (e) {
        if ((e as { code?: number }).code === 11000) return "duplicate";
        throw e;
      }
      try {
        await segments.insertMany(
          t.rows.map((r) => ({
            tripId: t.tripId,
            day: t.day,
            cellLat: r.cellLat,
            cellLon: r.cellLon,
            rri: r.rri,
            speedKph: r.speedKph,
            samples: r.samples,
          })),
          { ordered: false },
        );
        const speedDocs = [
          ...t.rows.map((r) => ({ tripId: t.tripId, cellLat: r.cellLat, cellLon: r.cellLon, daypart: t.daypart, speedKph: r.speedKph })),
          ...t.slow.map((r) => ({ tripId: t.tripId, cellLat: r.cellLat, cellLon: r.cellLon, daypart: t.daypart, speedKph: r.speedKph })),
        ];
        if (speedDocs.length) await speeds.insertMany(speedDocs, { ordered: false });
      } catch (e) {
        await segments.deleteMany({ tripId: t.tripId });
        await speeds.deleteMany({ tripId: t.tripId });
        await trips.deleteOne({ _id: t.tripId });
        throw e;
      }
      return "ok";
    },

    async loadCells(): Promise<CellsResult> {
      // Per trip first (mean within a trip), then across trips: matches the SQLite store.
      const grouped = await segments
        .aggregate<{ _id: { cl: number; co: number }; rri: number; spread: number | null; speed: number; trips: number }>([
          { $group: { _id: { cl: "$cellLat", co: "$cellLon", trip: "$tripId" }, rri: { $avg: "$rri" }, speed: { $avg: "$speedKph" } } },
          {
            $group: {
              _id: { cl: "$_id.cl", co: "$_id.co" },
              rri: { $avg: "$rri" },
              spread: { $stdDevSamp: "$rri" }, // null when a cell has a single trip
              speed: { $avg: "$speed" },
              trips: { $sum: 1 },
            },
          },
        ])
        .toArray();

      const cells: Cell[] = grouped.map((g2) => {
        const c = cellCenter(g2._id.cl, g2._id.co);
        return {
          id: `${g2._id.cl}:${g2._id.co}`,
          lat: c.lat,
          lon: c.lon,
          rri: g2.rri,
          trips: g2.trips,
          spread: g2.spread ?? null,
          speedKph: g2.speed,
        };
      });
      const sp = await speeds
        .aggregate<{ _id: { cl: number; co: number; dp: number }; speed: number; n: number }>([
          { $group: { _id: { cl: "$cellLat", co: "$cellLon", dp: "$daypart", trip: "$tripId" }, speed: { $avg: "$speedKph" } } },
          { $group: { _id: { cl: "$_id.cl", co: "$_id.co", dp: "$_id.dp" }, speed: { $avg: "$speed" }, n: { $sum: 1 } } },
        ])
        .toArray();
      const tmap = new Map<string, TrafficCell>();
      for (const r of sp) {
        const key = `${r._id.cl}:${r._id.co}`;
        let e = tmap.get(key);
        if (!e) {
          const c = cellCenter(r._id.cl, r._id.co);
          e = { id: key, lat: c.lat, lon: c.lon, bands: [] };
          tmap.set(key, e);
        }
        e.bands.push({ daypart: r._id.dp, n: r.n, speedKph: r.speed });
      }
      const traffic = [...tmap.values()].map((c) => ({ ...c, bands: c.bands.sort((a, b) => a.daypart - b.daypart) }));
      const [totalSegments, totalTrips] = await Promise.all([segments.countDocuments({}), trips.countDocuments({})]);
      const [first, last] = await Promise.all([trips.find({}).sort({ day: 1 }).limit(1).next(), trips.find({}).sort({ day: -1 }).limit(1).next()]);
      return { cells, traffic, totalSegments, totalTrips, firstDay: first?.day ?? null, lastDay: last?.day ?? null };
    },
  };
}
