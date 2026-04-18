// Nearest-city lookup shared by the map picker and the default-observation
// bootstrapper. Kept DOM-free so it can run during boot before any UI is
// mounted.

export interface CityLike {
  name: string;
  lat: number;
  lon: number;
}

/** Great-circle distance in kilometres between two WGS-84 coordinates. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Return the city in `cities` nearest to (lat, lon), or `null` if the list
 * is empty. Uses a Haversine linear scan — fine for the ~N thousand-city
 * catalogue we ship.
 */
export function nearestCity<T extends CityLike>(
  lat: number,
  lon: number,
  cities: ReadonlyArray<T>
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const c of cities) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
