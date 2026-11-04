// Turns a raw value into words, by where it sits among all the roads on this map. These are RELATIVE
// labels ("rougher than 90% of the roads here"), never an engineering grade.

export type Level = { label: string; tone: 0 | 1 | 2 | 3; pct: number }; // pct: 0..100, share of roads this one is rougher than

export const MIN_CELLS_TO_COMPARE = 8;

export function rankPct(v: number, sortedAll: number[]): number {
  if (!sortedAll.length) return 0;
  let below = 0;
  let equal = 0;
  for (const x of sortedAll) {
    if (x < v) below++;
    else if (x === v) equal++;
  }
  return ((below + equal / 2) / sortedAll.length) * 100;
}

export function roughnessLevel(v: number, sortedAll: number[]): Level | null {
  if (sortedAll.length < MIN_CELLS_TO_COMPARE) return null; // too little data to say anything is rough "compared to" the rest
  const pct = rankPct(v, sortedAll);
  if (pct < 30) return { label: "Smoother", tone: 0, pct };
  if (pct < 65) return { label: "Moderate", tone: 1, pct };
  if (pct < 88) return { label: "Rough", tone: 2, pct };
  return { label: "Roughest", tone: 3, pct };
}

// Speed is absolute, not relative: 15 km/h or less is slow (see SLOW_KPH in traffic.ts).
export function speedLevel(kph: number): Level {
  if (kph < 8) return { label: "Crawling", tone: 3, pct: 0 };
  if (kph < 15) return { label: "Slow", tone: 2, pct: 0 };
  if (kph < 30) return { label: "Moderate", tone: 1, pct: 0 };
  return { label: "Flowing", tone: 0, pct: 0 };
}
