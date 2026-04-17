// Astronomical time utilities.
//
// References (cited inline throughout):
//   Meeus, J. "Astronomical Algorithms", 2nd ed. 1998 (Willmann-Bell).
//     Ch. 7  — Julian Day
//     Ch. 12 — Sidereal Time at Greenwich
//     Ch. 22 — Nutation and the Obliquity of the Ecliptic
//
// All times flow as UTC epoch milliseconds at the module boundary.
// Callers (e.g. ui/tz-resolver.ts) are responsible for providing the
// correct UTC offset to `utcMsFromLocal`; this module does NOT consult
// any timezone database.

const MS_PER_DAY = 86_400_000;
// Julian Date of the Unix epoch (1970-01-01T00:00:00 UTC).
// Meeus Ch. 7: JD of 1970-01-01 0h UT = 2440587.5 exactly.
const JD_UNIX_EPOCH = 2_440_587.5;
// Julian Date of J2000.0 (2000-01-01T12:00:00 TT, adopted here as UTC
// for the accuracy tier we target — the ΔT difference is < 1 s which
// is well under our 0.1° budget). Meeus Ch. 7.
export const JD_J2000 = 2_451_545.0;
// Julian century length in days, Meeus eq. 12.1.
export const JULIAN_CENTURY_DAYS = 36_525;

const TAU = Math.PI * 2;
const DEG2RAD = Math.PI / 180;

/**
 * Julian Date (UT) for a UTC instant in epoch milliseconds.
 * Meeus Ch. 7, eq. 7.1: JD = days since JD epoch.
 */
export function julianDate(utcMs: number): number {
  return JD_UNIX_EPOCH + utcMs / MS_PER_DAY;
}

/**
 * Julian centuries since J2000.0.
 * Meeus Ch. 22, eq. 22.1: T = (JD − 2451545.0) / 36525.
 */
export function julianCenturiesJ2000(utcMs: number): number {
  return (julianDate(utcMs) - JD_J2000) / JULIAN_CENTURY_DAYS;
}

/**
 * Mean obliquity of the ecliptic (radians), Meeus eq. 22.2 (IAU 1980
 * expression, accurate to ~1" over 1900–2100).
 */
function meanObliquityRad(T: number): number {
  // ε₀ = 23°26'21.448" − 46.8150" T − 0.00059" T² + 0.001813" T³
  const eps0Arcsec =
    23 * 3600 + 26 * 60 + 21.448 + (-46.8150 + (-0.00059 + 0.001813 * T) * T) * T;
  return (eps0Arcsec / 3600) * DEG2RAD;
}

/**
 * Reduce a radian angle to [0, 2π).
 */
function normalizeAngle(rad: number): number {
  const m = rad % TAU;
  return m < 0 ? m + TAU : m;
}

/**
 * Greenwich Mean Sidereal Time in radians for a UTC instant.
 *
 * IAU 1982 formula (Meeus Ch. 12, eq. 12.4):
 *   GMST (deg) = 280.46061837
 *              + 360.98564736629 · (JD − 2451545.0)
 *              + 0.000387933 · T²
 *              − T³ / 38710000
 * where T is Julian centuries since J2000.0.
 */
export function greenwichMeanSiderealTimeRad(utcMs: number): number {
  const jd = julianDate(utcMs);
  const D = jd - JD_J2000;
  const T = D / JULIAN_CENTURY_DAYS;
  const gmstDeg =
    280.46061837 +
    360.98564736629 * D +
    0.000387933 * T * T -
    (T * T * T) / 38_710_000;
  return normalizeAngle(gmstDeg * DEG2RAD);
}

/**
 * Equation of the equinoxes (radians), Meeus Ch. 12 p. 88.
 *
 * EqEq = Δψ · cos(ε), where Δψ is nutation in longitude and ε is the
 * mean obliquity. We use a truncated nutation series keeping only the
 * dominant 18.6-year luni-solar term — Meeus eq. 22.A gives:
 *   Δψ ≈ −17.20" · sin(Ω)
 *        −  1.32" · sin(2 L_Sun)
 *        −  0.23" · sin(2 L_Moon)
 *        +  0.21" · sin(2 Ω)
 * where Ω is the longitude of the ascending node of the Moon's mean
 * orbit. This is well within the 0.1° accuracy tier (sidereal-time
 * error of keeping only the Ω term is < 0.2").
 */
function equationOfEquinoxesRad(utcMs: number): number {
  const T = julianCenturiesJ2000(utcMs);
  // Longitude of ascending node of the Moon (degrees) — Meeus eq. 22.4.
  const omegaDeg = 125.04452 - 1934.136261 * T + 0.0020708 * T * T + (T * T * T) / 450000;
  // Mean longitudes of Sun and Moon (degrees) — Meeus eq. 22.3.
  const LSunDeg = 280.4665 + 36000.7698 * T;
  const LMoonDeg = 218.3165 + 481267.8813 * T;

  const omega = omegaDeg * DEG2RAD;
  const L = LSunDeg * DEG2RAD;
  const Lp = LMoonDeg * DEG2RAD;

  // Nutation in longitude, arcseconds — truncated series (Meeus Ch. 22).
  const dPsiArcsec =
    -17.2 * Math.sin(omega) +
    -1.32 * Math.sin(2 * L) +
    -0.23 * Math.sin(2 * Lp) +
    0.21 * Math.sin(2 * omega);

  const eps = meanObliquityRad(T);
  const dPsiRad = (dPsiArcsec / 3600) * DEG2RAD;
  return dPsiRad * Math.cos(eps);
}

/**
 * Greenwich Apparent Sidereal Time in radians. GAST = GMST + EqEq.
 * Meeus Ch. 12, unnumbered eq. p. 88.
 */
export function greenwichApparentSiderealTimeRad(utcMs: number): number {
  return normalizeAngle(greenwichMeanSiderealTimeRad(utcMs) + equationOfEquinoxesRad(utcMs));
}

/**
 * Convert a local civil date/time plus UTC offset to a UTC epoch ms.
 *
 * `localDate` is `YYYY-MM-DD`, `localTime` is `HH:MM` (24-hour).
 * `utcOffsetMinutes` is the offset of the local zone from UTC (e.g.
 * −300 for US Eastern Standard Time). The relationship is:
 *   utcMs = localAsIfUtcMs − utcOffsetMinutes · 60_000
 *
 * This is a pure arithmetic function. It does NOT consult the IANA
 * timezone database; the caller (see src/ui/tz-resolver.ts) is
 * responsible for supplying the correct offset for the chosen zone
 * and date (including DST).
 */
export function utcMsFromLocal(
  localDate: string,
  localTime: string,
  utcOffsetMinutes: number,
): number {
  const dateParts = localDate.split('-');
  const timeParts = localTime.split(':');
  if (dateParts.length !== 3 || timeParts.length < 2) {
    throw new Error(`utcMsFromLocal: invalid input date="${localDate}" time="${localTime}"`);
  }
  const y = Number(dateParts[0]);
  const mo = Number(dateParts[1]);
  const d = Number(dateParts[2]);
  const h = Number(timeParts[0]);
  const mi = Number(timeParts[1]);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(mo) ||
    !Number.isFinite(d) ||
    !Number.isFinite(h) ||
    !Number.isFinite(mi)
  ) {
    throw new Error(`utcMsFromLocal: non-numeric component in "${localDate} ${localTime}"`);
  }
  // `Date.UTC` treats its arguments as UTC calendar fields. Feed the
  // LOCAL wall-clock into `Date.UTC` to get "this local moment as if it
  // were UTC", then subtract the offset to get the actual UTC instant.
  const localAsUtcMs = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  return localAsUtcMs - utcOffsetMinutes * 60_000;
}
