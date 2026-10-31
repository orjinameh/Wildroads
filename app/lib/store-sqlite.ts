import { cellCenter } from "./grid";
import { getDb } from "./db";
import type { Cell, CellsResult, NewTrip, Store } from "./types";

export async function createSqliteStore(): Promise<Store> {
  return {
    async insertTrip(t: NewTrip) {
      const db = getDb();
      const exists = db.prepare("SELECT 1 AS x FROM segments WHERE trip_id = ? LIMIT 1").get(t.tripId);
      if (exists) return "duplicate";
      const insert = db.prepare(
        `INSERT INTO segments (trip_id, day, cell_lat, cell_lon, rri, speed_kph, samples, device_class, rate_hz)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      db.exec("BEGIN");
      try {
        for (const r of t.rows) insert.run(t.tripId, t.day, r.cellLat, r.cellLon, r.rri, r.speedKph, r.samples, t.deviceClass, t.rateHz);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return "ok";
    },

    async loadCells(): Promise<CellsResult> {
      const db = getDb();
      const rows = db
        .prepare(
          `SELECT cell_lat AS cl, cell_lon AS co, trip_id AS trip, AVG(rri) AS rri, AVG(speed_kph) AS speed
           FROM segments GROUP BY cell_lat, cell_lon, trip_id`,
        )
        .all() as { cl: number; co: number; trip: string; rri: number; speed: number }[];

      const byCell = new Map<string, { cl: number; co: number; rris: number[]; speeds: number[] }>();
      for (const r of rows) {
        const key = `${r.cl}:${r.co}`;
        const e = byCell.get(key) ?? { cl: r.cl, co: r.co, rris: [], speeds: [] };
        e.rris.push(r.rri);
        e.speeds.push(r.speed);
        byCell.set(key, e);
      }

      const cells: Cell[] = [];
      for (const [key, e] of byCell) {
        const n = e.rris.length;
        const mean = e.rris.reduce((s, x) => s + x, 0) / n;
        const spread = n >= 2 ? Math.sqrt(e.rris.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : null;
        const c = cellCenter(e.cl, e.co);
        cells.push({ id: key, lat: c.lat, lon: c.lon, rri: mean, trips: n, spread, speedKph: e.speeds.reduce((s, x) => s + x, 0) / n });
      }

      const totals = db.prepare(`SELECT COUNT(*) AS segs, COUNT(DISTINCT trip_id) AS trips FROM segments`).get() as {
        segs: number;
        trips: number;
      };
      return { cells, totalSegments: totals.segs, totalTrips: totals.trips };
    },
  };
}
