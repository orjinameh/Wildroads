// The only location resolution that is ever stored: a ~22 m grid.
export const CELL_DEG = 0.0002;

export function cellOf(lat: number, lon: number) {
  return { cellLat: Math.round(lat / CELL_DEG), cellLon: Math.round(lon / CELL_DEG) };
}

export function cellCenter(cellLat: number, cellLon: number) {
  return { lat: cellLat * CELL_DEG, lon: cellLon * CELL_DEG };
}
