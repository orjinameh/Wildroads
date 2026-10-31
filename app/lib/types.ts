export type Cell = {
  id: string;
  lat: number;
  lon: number;
  rri: number; // mean of per-trip means
  trips: number; // independent trips that measured this cell
  spread: number | null; // sample std-dev of per-trip means (null with a single trip)
  speedKph: number;
};

export type CellsResult = { cells: Cell[]; totalSegments: number; totalTrips: number };

export type NewSegment = { cellLat: number; cellLon: number; rri: number; speedKph: number; samples: number };

export type NewTrip = {
  tripId: string;
  day: string;
  deviceClass: string;
  rateHz: number | null;
  rows: NewSegment[];
};

export interface Store {
  /** Stores a trip atomically. Returns "duplicate" if this tripId was already uploaded. */
  insertTrip(trip: NewTrip): Promise<"ok" | "duplicate">;
  loadCells(): Promise<CellsResult>;
}
