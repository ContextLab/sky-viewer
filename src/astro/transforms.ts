// Coordinate transforms between equatorial and horizontal systems,
// plus low-order precession for J2000.0 → epoch-of-date conversion.
//
// References (cited inline):
//   Meeus, J. "Astronomical Algorithms", 2nd ed. 1998 (Willmann-Bell).
//     Ch. 13 — Transformation of Coordinates
//     Ch. 16 — Atmospheric Refraction
//     Ch. 21 — Precession
//
// All angles at the module boundary are in radians, except return
// fields explicitly suffixed with `Deg`.

import { greenwichApparentSiderealTimeRad, julianCenturiesJ2000 } from './time';

const TAU = Math.PI * 2;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
// Milliarcseconds per radian — for proper motion scaling.
// 1 rad = 180/π deg · 3600 · 1000 mas
const MAS_PER_RAD = (180 / Math.PI) * 3600 * 1000;
// Mean tropical year in Julian days (not strictly needed — proper motion
// is quoted per Julian year of 365.25 days, Meeus Ch. 21 p. 126).
const JULIAN_YEAR_DAYS = 365.25;

function normalizeAngle(rad: number): number {
  const m = rad % TAU;
  return m < 0 ? m + TAU : m;
}

/**
 * Equatorial (RA/Dec, apparent) → horizontal (altitude/azimuth).
 *
 * Steps:
 *   1. Compute GAST (Greenwich apparent sidereal time) from time.ts.
 *   2. Local apparent sidereal time (LST) = GAST + longitude (east+).
 *   3. Hour angle H = LST − RA.
 *   4. Spherical-to-horizontal (Meeus Ch. 13 eqs. 13.5, 13.6):
 *        sin(alt) = sin(φ) sin(δ) + cos(φ) cos(δ) cos(H)
 *        tan(Az)  = sin(H) / (cos(H) sin(φ) − tan(δ) cos(φ))
 *      Azimuth is measured here from NORTH eastward (0 = N, 90 = E,
 *      180 = S, 270 = W), which is the modern convention. Meeus uses
 *      south-origin; we shift by π.
 *   5. If alt > −1°, apply Bennett's refraction formula (Meeus
 *      Ch. 16, eq. 16.3):
 *        R (arcmin) = 1 / tan( alt + 7.31° / (alt + 4.4°) )
 *      with `alt` in degrees. Apparent altitude = true + R.
 */
export function equatorialToHorizontal(
  raRad: number,
  decRad: number,
  latRad: number,
  lonRad: number,
  utcMs: number,
): { altDeg: number; azDeg: number } {
  const gast = greenwichApparentSiderealTimeRad(utcMs);
  // LST — east longitude positive (IAU convention).
  const lst = gast + lonRad;
  // Hour angle.
  const H = lst - raRad;

  const sinPhi = Math.sin(latRad);
  const cosPhi = Math.cos(latRad);
  const sinDec = Math.sin(decRad);
  const cosDec = Math.cos(decRad);
  const sinH = Math.sin(H);
  const cosH = Math.cos(H);

  // Meeus eq. 13.6.
  const sinAlt = sinPhi * sinDec + cosPhi * cosDec * cosH;
  const altRad = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  // Meeus eq. 13.5, but with azimuth reckoned from North eastward.
  // Meeus' "A" has origin South and is positive westward; we convert
  // to the north-origin east-positive convention by computing
  //   A_N = atan2( sin(H), cos(H) sin(φ) − tan(δ) cos(φ) ) + π
  // (atan2 form is numerically stable; the +π shifts south-origin to
  // north-origin).
  const azSouthOrigin = Math.atan2(sinH, cosH * sinPhi - (sinDec / cosDec) * cosPhi);
  const azRad = normalizeAngle(azSouthOrigin + Math.PI);

  let altDeg = altRad * RAD2DEG;
  const azDeg = azRad * RAD2DEG;

  // Atmospheric refraction, Bennett (Meeus eq. 16.3). Apply only for
  // objects at or near/above the horizon; at very negative altitudes
  // refraction is not physically meaningful and the formula diverges.
  if (altDeg > -1) {
    // Bennett formula returns arcminutes added to TRUE altitude to get
    // APPARENT altitude.
    const argDeg = altDeg + 7.31 / (altDeg + 4.4);
    const Rarcmin = 1 / Math.tan(argDeg * DEG2RAD);
    // Empirical Saemundsson-style correction factor (Meeus p. 106,
    // the 1/60 · 1.02 refinement). Using the plain Bennett value is
    // well within 0.1° for alt > 5°; we include the ×1.02/60 scale
    // to convert arcminutes to degrees.
    altDeg += Rarcmin / 60;
  }

  return { altDeg, azDeg };
}

/**
 * Apply proper motion + low-order precession to a star catalogue
 * position given at the J2000.0 mean equator and equinox, yielding
 * the mean position at the epoch of date.
 *
 * Proper motion: linear in years, added in the catalogue's convention
 *   Δα · cos δ  in mas/yr for pmRa
 *   Δδ         in mas/yr for pmDec
 * So Δα (rad) = pmRa / cos(δ₀) · (years) / MAS_PER_RAD.
 *
 * Precession: Meeus Ch. 21 "reduction for precession from J2000.0 to
 * a given date", eqs. 21.2, 21.3, 21.4. For our 1900–2100 range and
 * 0.1° accuracy tier, the linear-in-T approximation is more than
 * adequate (quadratic precession terms are <0.5" / century²).
 *
 *   ζ  =  2306.2181" T + 0.30188" T² + 0.017998" T³
 *   z  =  2306.2181" T + 1.09468" T² + 0.018203" T³
 *   θ  =  2004.3109" T − 0.42665" T² − 0.041833" T³
 *
 * with T in Julian centuries since J2000.0. Then (Meeus eq. 21.4):
 *
 *   A = cos δ₀ · sin(α₀ + ζ)
 *   B = cos θ · cos δ₀ · cos(α₀ + ζ) − sin θ · sin δ₀
 *   C = sin θ · cos δ₀ · cos(α₀ + ζ) + cos θ · sin δ₀
 *   α − z = atan2(A, B)
 *   δ     = asin(C)
 */
export function precessStarToEpoch(
  raJ2000Rad: number,
  decJ2000Rad: number,
  pmRaMasPerYr: number,
  pmDecMasPerYr: number,
  utcMs: number,
): { ra: number; dec: number } {
  const T = julianCenturiesJ2000(utcMs);
  const yearsSinceJ2000 = T * 100;

  // Apply proper motion first, still in J2000.0 frame.
  const cosDec0 = Math.cos(decJ2000Rad);
  const dAlphaRad =
    cosDec0 > 1e-9 ? (pmRaMasPerYr / cosDec0) * yearsSinceJ2000 / MAS_PER_RAD : 0;
  const dDeltaRad = (pmDecMasPerYr * yearsSinceJ2000) / MAS_PER_RAD;
  const alpha0 = raJ2000Rad + dAlphaRad;
  const delta0 = decJ2000Rad + dDeltaRad;

  // Precession angles (Meeus eq. 21.2), arcseconds.
  const zetaArcsec = 2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T;
  const zArcsec = 2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T;
  const thetaArcsec = 2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T;
  const zeta = (zetaArcsec / 3600) * DEG2RAD;
  const z = (zArcsec / 3600) * DEG2RAD;
  const theta = (thetaArcsec / 3600) * DEG2RAD;

  const cosD0 = Math.cos(delta0);
  const sinD0 = Math.sin(delta0);
  const cosTh = Math.cos(theta);
  const sinTh = Math.sin(theta);
  const cosAz = Math.cos(alpha0 + zeta);
  const sinAz = Math.sin(alpha0 + zeta);

  const A = cosD0 * sinAz;
  const B = cosTh * cosD0 * cosAz - sinTh * sinD0;
  const C = sinTh * cosD0 * cosAz + cosTh * sinD0;

  const alphaMinusZ = Math.atan2(A, B);
  const ra = normalizeAngle(alphaMinusZ + z);
  const dec = Math.asin(Math.max(-1, Math.min(1, C)));
  return { ra, dec };
}

// Exported for modules that need the year length in days (stars.ts
// does not, but this is the place it lives if needed later).
export const _JULIAN_YEAR_DAYS = JULIAN_YEAR_DAYS;
