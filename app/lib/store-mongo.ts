// MongoDB Atlas storage. Same data model and same results as the SQLite store.
//   trips:    one document per upload, _id = tripId (the unique _id makes duplicate uploads impossible)
//   segments: one document per ~22 m cell measurement; no identity, no timestamps beyond a UTC day
import { MongoClient } from "mongodb";
import { cellCenter } from "./grid";
import type { Cell, CellsResult, NewTrip, Store } from "./types";

// Reuse one client across invocations of a serverless function instance.
const g = globalThis as unknown as { _wildroadsMongo?: Promise<MongoClient> };

export async function createMongoStore(uri: string): Promise<Store> {
  if (!g._wildroadsMongo) g._wildroadsMongo = new MongoClient(uri, { maxPoolSize: 5 }).connect();
  const client = await g._wildroadsMongo;
  const db = client.db(process.env.MONGODB_DB ?? "wildroads");
  const segments = db.collection("segments");
  const trips = db.collection<{ _id: string; day: string; deviceClass: string; rateHz: number | null; segments: number }>("trips");

  await Promise.all([segments.createIndex({ tripId: 1 }), segments.createIndex({ cellLat: 1, cellLon: 1 })]);

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
      } catch (e) {
        await segments.deleteMany({ tripId: t.tripId });
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
      const [totalSegments, totalTrips] = await Promise.all([segments.countDocuments({}), trips.countDocuments({})]);
      return { cells, totalSegments, totalTrips };
    },
  };
}
