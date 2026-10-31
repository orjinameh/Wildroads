// Time of day is only ever stored as one of four coarse bands (never a timestamp),
// computed on the phone from local time.
export const DAYPARTS = ["Night", "Morning", "Midday", "Evening"] as const;
export const DAYPART_HOURS = ["22:00-05:00", "05:00-11:00", "11:00-16:00", "16:00-22:00"] as const;

export function daypartOfHour(hour: number): number {
  if (hour >= 22 || hour < 5) return 0;
  if (hour < 11) return 1;
  if (hour < 16) return 2;
  return 3;
}

// Speed under this is "slow" on the map and in reports. An absolute threshold, not a congestion model.
export const SLOW_KPH = 15;
