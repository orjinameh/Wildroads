import type { Store } from "./types";

let cached: Promise<Store> | null = null;

/**
 * MONGODB_URI set  -> MongoDB Atlas (use this on Vercel: serverless disks are not persistent)
 * otherwise        -> SQLite file in DATA_DIR (local development)
 */
export function getStore(): Promise<Store> {
  if (!cached) {
    const uri = process.env.MONGODB_URI;
    if (!uri && process.env.VERCEL) {
      // Vercel's disk is read-only and disposable, so the SQLite fallback can never work there.
      return Promise.reject(
        new Error("Storage is not configured. Add MONGODB_URI under Project Settings → Environment Variables in Vercel, then redeploy."),
      );
    }
    cached = uri
      ? import("./store-mongo").then((m) => m.createMongoStore(uri))
      : import("./store-sqlite").then((m) => m.createSqliteStore());
    cached.catch(() => {
      cached = null; // allow a retry on the next request if the connection failed
    });
  }
  return cached;
}
