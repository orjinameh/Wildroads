export type Cell = {
  id: string;
  lat: number;
  lon: number;
  rri: number; // mean of per-trip means
  trips: number; // independent trips that measured this cell
  spread: number | null; // sample std-dev of per-trip means (null with a single trip)
  speedKph: number;
};

// Speed seen in one cell during one part of the day. n = independent trips, speedKph = mean of per-trip mean speeds.
export type TrafficBand = { daypart: number; n: number; speedKph: number };
export type TrafficCell = { id: string; lat: number; lon: number; bands: TrafficBand[] };

export type CellsResult = { cells: Cell[]; traffic: TrafficCell[]; totalSegments: number; totalTrips: number };

export type NewSegment = { cellLat: number; cellLon: number; rri: number; speedKph: number; samples: number };

// A segment too slow for roughness, kept only as a speed observation.
export type NewSlow = { cellLat: number; cellLon: number; speedKph: number };

export type NewTrip = {
  tripId: string;
  day: string;
  deviceClass: string;
  rateHz: number | null;
  rows: NewSegment[];
  daypart: number; // 0-3, see lib/traffic.ts
  slow: NewSlow[];
};

export interface Store {
  /** Stores a trip atomically. Returns "duplicate" if this tripId was already uploaded. */
  insertTrip(trip: NewTrip): Promise<"ok" | "duplicate">;
  loadCells(): Promise<CellsResult>;
}
