// SQLite via Node's built-in module (no native dependency). Loaded with getBuiltinModule
// so the bundler never tries to resolve "node:sqlite".
import fs from "node:fs";
import path from "node:path";

type Sqlite = typeof import("node:sqlite");
type Db = InstanceType<Sqlite["DatabaseSync"]>;

let db: Db | null = null;

export const CELL_DEG = 0.0002; // ~22 m grid, the only location resolution stored

export function cellOf(lat: number, lon: number) {
  return { cellLat: Math.round(lat / CELL_DEG), cellLon: Math.round(lon / CELL_DEG) };
}

export function cellCenter(cellLat: number, cellLon: number) {
  return { lat: cellLat * CELL_DEG, lon: cellLon * CELL_DEG };
}

export function getDb(): Db {
  if (db) return db;
  const sqlite = process.getBuiltinModule("node:sqlite") as Sqlite;
  const dir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const d = new sqlite.DatabaseSync(path.join(dir, "wildroads.db"));
  d.exec(`
    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id TEXT NOT NULL,
      day TEXT NOT NULL,
      cell_lat INTEGER NOT NULL,
      cell_lon INTEGER NOT NULL,
      rri REAL NOT NULL,
      speed_kph REAL NOT NULL,
      samples INTEGER NOT NULL,
      device_class TEXT NOT NULL,
      rate_hz REAL
    );
    CREATE INDEX IF NOT EXISTS idx_segments_cell ON segments(cell_lat, cell_lon);
    CREATE INDEX IF NOT EXISTS idx_segments_trip ON segments(trip_id);
  `);
  db = d;
  return d;
}
