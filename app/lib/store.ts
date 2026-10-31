import type { Store } from "./types";

let cached: Promise<Store> | null = null;

/**
 * MONGODB_URI set  -> MongoDB Atlas (use this on Vercel: serverless disks are not persistent)
 * otherwise        -> SQLite file in DATA_DIR (self-hosted Docker Compose stack)
 */
export function getStore(): Promise<Store> {
  if (!cached) {
    const uri = process.env.MONGODB_URI;
    cached = uri
      ? import("./store-mongo").then((m) => m.createMongoStore(uri))
      : import("./store-sqlite").then((m) => m.createSqliteStore());
    cached.catch(() => {
      cached = null; // allow a retry on the next request if the connection failed
    });
  }
  return cached;
}
