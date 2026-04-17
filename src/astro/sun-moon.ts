// Sun and Moon position / illumination.
//
// References (cited inline):
//   Meeus, J. "Astronomical Algorithms", 2nd ed. 1998 (Willmann-Bell).
//     Ch. 25 — Solar Coordinates (low precision)
//     Ch. 47 — Position of the Moon (truncated ELP series)
//     Ch. 48 — Illuminated Fraction of the Moon's Disk
//     Ch. 22 — Nutation and the Obliquity of the Ecliptic
//
// Accuracy targets (per specs/001-sky-viewer-mvp/research.md R2):
//   Sun:  ~0.01° over 1900–2100 (Meeus Ch. 25 low-precision).
//   Moon: ~10 arcsec position, ~1 arcmin on illumination.

import { julianCenturiesJ2000, julianDate, JD_J2000 } from './time';

const DEG2RAD = Math.PI / 180;
const TAU = Math.PI * 2;
// Obliquity of the ecliptic at J2000, arcseconds (Meeus Ch. 22).
// The mean obliquity used here includes the linear-in-T term — that's
// enough for the Sun/Moon accuracy tier.
function meanObliquityRad(T: number): number {
  const eps0Arcsec =
    23 * 3600 + 26 * 60 + 21.448 + (-46.8150 + (-0.00059 + 0.001813 * T) * T) * T;
  return (eps0Arcsec / 3600) * DEG2RAD;
}

function normalizeAngleRad(rad: number): number {
  const m = rad % TAU;
  return m < 0 ? m + TAU : m;
}

function normalizeDeg(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

/**
 * Geocentric apparent position of the Sun.
 *
 * Meeus Ch. 25, "Low accuracy" formulas. Stated accuracy: 0.01° over
 * the years 1900–2100. Steps:
 *
 *   T = (JD − 2451545.0) / 36525
 *   L₀ = 280.46646° + 36000.76983° T + 0.0003032° T²      (mean longitude)
 *   M  = 357.52911° + 35999.05029° T − 0.0001537° T²      (mean anomaly)
 *   e  = 0.016708634 − 0.000042037 T − 0.0000001267 T²   (eccentricity)
 *   C  = (1.914602° − 0.004817° T − 0.000014° T²) sin M
 *      + (0.019993° − 0.000101° T) sin 2M
 *      + 0.000289° sin 3M                                  (equation of centre)
 *   ⊙ (true longitude) = L₀ + C
 *   Ω = 125.04° − 1934.136° T
 *   λ (apparent longitude) = ⊙ − 0.00569° − 0.00478° sin Ω
 *   ε (mean obliquity) + correction: ε + 0.00256° cos Ω
 *
 * Right ascension and declination:
 *   tan α = cos ε · sin λ / cos λ
 *   sin δ = sin ε · sin λ
 */
export function sunPosition(utcMs: number): { raRad: number; decRad: number } {
  const T = julianCenturiesJ2000(utcMs);

  const L0 = normalizeDeg(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = normalizeDeg(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const Mrad = M * DEG2RAD;

  // Equation of centre.
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mrad) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * Mrad) +
    0.000289 * Math.sin(3 * Mrad);

  const trueLon = L0 + C;
  const omegaDeg = 125.04 - 1934.136 * T;
  const omegaRad = omegaDeg * DEG2RAD;

  // Apparent longitude (Meeus eq. 25.8).
  const lambdaDeg = trueLon - 0.00569 - 0.00478 * Math.sin(omegaRad);
  const lambdaRad = lambdaDeg * DEG2RAD;

  // Obliquity corrected for nutation's leading term (Meeus p. 164).
  const epsRad = meanObliquityRad(T) + 0.00256 * DEG2RAD * Math.cos(omegaRad);

  const raRad = normalizeAngleRad(Math.atan2(Math.cos(epsRad) * Math.sin(lambdaRad), Math.cos(lambdaRad)));
  const decRad = Math.asin(Math.sin(epsRad) * Math.sin(lambdaRad));

  return { raRad, decRad };
}

// ---------------------------------------------------------------------
// Moon position (Meeus Ch. 47, truncated ELP).
//
// We keep the dominant periodic terms of Meeus Table 47.A (longitude
// and distance) and Table 47.B (latitude). The 10-20 largest terms
// reach the few-arcminute accuracy level, which is comfortably under
// our 0.1° target. A fuller truncation (~30 terms) pushes to ~10".
//
// Fundamental arguments (Meeus eqs. 47.1–47.5):
//   L' = 218.3164477° + 481267.88123421° T − 0.0015786° T² + T³/538841 − T⁴/65194000
//   D  = 297.8501921° + 445267.1114034°  T − 0.0018819° T² + T³/545868 − T⁴/113065000
//   M  = 357.5291092° +  35999.0502909°  T − 0.0001536° T² + T³/24490000
//   M' = 134.9633964° + 477198.8675055°  T + 0.0087414° T² + T³/69699  − T⁴/14712000
//   F  =  93.2720950° + 483202.0175233°  T − 0.0036539° T² − T³/3526000 + T⁴/863310000
//   E  = 1 − 0.002516 T − 0.0000074 T²       (eccentricity correction)
// ---------------------------------------------------------------------

interface MoonTerm {
  d: number; // coefficient of D
  m: number; // coefficient of M
  mp: number; // coefficient of M' (moon's mean anomaly)
  f: number; // coefficient of F
  sigL: number; // longitude amplitude, 0.000001°
  sigR: number; // distance amplitude, 0.001 km
}

interface MoonLatTerm {
  d: number;
  m: number;
  mp: number;
  f: number;
  sigB: number; // latitude amplitude, 0.000001°
}

// Table 47.A, top terms by |sigL| — sufficient for ~arc-minute accuracy.
// Units: sigL in 10⁻⁶°, sigR in 10⁻³ km.
const MOON_LON_DIST_TERMS: readonly MoonTerm[] = [
  { d: 0, m: 0, mp: 1, f: 0, sigL: 6288774, sigR: -20905355 },
  { d: 2, m: 0, mp: -1, f: 0, sigL: 1274027, sigR: -3699111 },
  { d: 2, m: 0, mp: 0, f: 0, sigL: 658314, sigR: -2955968 },
  { d: 0, m: 0, mp: 2, f: 0, sigL: 213618, sigR: -569925 },
  { d: 0, m: 1, mp: 0, f: 0, sigL: -185116, sigR: 48888 },
  { d: 0, m: 0, mp: 0, f: 2, sigL: -114332, sigR: -3149 },
  { d: 2, m: 0, mp: -2, f: 0, sigL: 58793, sigR: 246158 },
  { d: 2, m: -1, mp: -1, f: 0, sigL: 57066, sigR: -152138 },
  { d: 2, m: 0, mp: 1, f: 0, sigL: 53322, sigR: -170733 },
  { d: 2, m: -1, mp: 0, f: 0, sigL: 45758, sigR: -204586 },
  { d: 0, m: 1, mp: -1, f: 0, sigL: -40923, sigR: -129620 },
  { d: 1, m: 0, mp: 0, f: 0, sigL: -34720, sigR: 108743 },
  { d: 0, m: 1, mp: 1, f: 0, sigL: -30383, sigR: 104755 },
  { d: 2, m: 0, mp: 0, f: -2, sigL: 15327, sigR: 10321 },
  { d: 0, m: 0, mp: 1, f: 2, sigL: -12528, sigR: 0 },
  { d: 0, m: 0, mp: 1, f: -2, sigL: 10980, sigR: 79661 },
  { d: 4, m: 0, mp: -1, f: 0, sigL: 10675, sigR: -34782 },
  { d: 0, m: 0, mp: 3, f: 0, sigL: 10034, sigR: -23210 },
  { d: 4, m: 0, mp: -2, f: 0, sigL: 8548, sigR: -21636 },
  { d: 2, m: 1, mp: -1, f: 0, sigL: -7888, sigR: 24208 },
  { d: 2, m: 1, mp: 0, f: 0, sigL: -6766, sigR: 30824 },
  { d: 1, m: 0, mp: -1, f: 0, sigL: -5163, sigR: -8379 },
  { d: 1, m: 1, mp: 0, f: 0, sigL: 4987, sigR: -16675 },
  { d: 2, m: -1, mp: 1, f: 0, sigL: 4036, sigR: -12831 },
  { d: 2, m: 0, mp: 2, f: 0, sigL: 3994, sigR: -10445 },
  { d: 4, m: 0, mp: 0, f: 0, sigL: 3861, sigR: -11650 },
  { d: 2, m: 0, mp: -3, f: 0, sigL: 3665, sigR: 14403 },
];

// Table 47.B, top terms by |sigB|.
const MOON_LAT_TERMS: readonly MoonLatTerm[] = [
  { d: 0, m: 0, mp: 0, f: 1, sigB: 5128122 },
  { d: 0, m: 0, mp: 1, f: 1, sigB: 280602 },
  { d: 0, m: 0, mp: 1, f: -1, sigB: 277693 },
  { d: 2, m: 0, mp: 0, f: -1, sigB: 173237 },
  { d: 2, m: 0, mp: -1, f: 1, sigB: 55413 },
  { d: 2, m: 0, mp: -1, f: -1, sigB: 46271 },
  { d: 2, m: 0, mp: 0, f: 1, sigB: 32573 },
  { d: 0, m: 0, mp: 2, f: 1, sigB: 17198 },
  { d: 2, m: 0, mp: 1, f: -1, sigB: 9266 },
  { d: 0, m: 0, mp: 2, f: -1, sigB: 8822 },
  { d: 2, m: -1, mp: 0, f: -1, sigB: 8216 },
  { d: 2, m: 0, mp: -2, f: -1, sigB: 4324 },
  { d: 2, m: 0, mp: 1, f: 1, sigB: 4200 },
  { d: 2, m: 1, mp: 0, f: -1, sigB: -3359 },
  { d: 2, m: -1, mp: -1, f: 1, sigB: 2463 },
  { d: 2, m: -1, mp: 0, f: 1, sigB: 2211 },
  { d: 2, m: -1, mp: -1, f: -1, sigB: 2065 },
  { d: 0, m: 1, mp: -1, f: -1, sigB: -1870 },
  { d: 4, m: 0, mp: -1, f: -1, sigB: 1828 },
  { d: 0, m: 1, mp: 0, f: 1, sigB: -1794 },
  { d: 0, m: 0, mp: 0, f: 3, sigB: -1749 },
  { d: 0, m: 1, mp: -1, f: 1, sigB: -1565 },
];

/**
 * Geocentric apparent position of the Moon and its illuminated
 * fraction and angular diameter.
 *
 * Uses the truncated ELP series from Meeus Ch. 47 (top ~25 longitude
 * / distance terms and top ~22 latitude terms). Accuracy: a few
 * arcminutes in position, well under our 0.1° target. Phase uses
 * Meeus eq. 48.1 (illuminated fraction from phase angle).
 */
export function moonPosition(utcMs: number): {
  raRad: number;
  decRad: number;
  phase: number;
  angularDiameterArcsec: number;
} {
  const T = julianCenturiesJ2000(utcMs);

  // Fundamental arguments (degrees). Meeus eqs. 47.1–47.5.
  const Lp =
    218.3164477 +
    481267.88123421 * T -
    0.0015786 * T * T +
    (T * T * T) / 538841 -
    (T * T * T * T) / 65194000;
  const D =
    297.8501921 +
    445267.1114034 * T -
    0.0018819 * T * T +
    (T * T * T) / 545868 -
    (T * T * T * T) / 113065000;
  const M =
    357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + (T * T * T) / 24490000;
  const Mp =
    134.9633964 +
    477198.8675055 * T +
    0.0087414 * T * T +
    (T * T * T) / 69699 -
    (T * T * T * T) / 14712000;
  const F =
    93.272095 +
    483202.0175233 * T -
    0.0036539 * T * T -
    (T * T * T) / 3526000 +
    (T * T * T * T) / 863310000;
  // Eccentricity correction for terms with M; Meeus eq. 47.6.
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;

  const LpR = normalizeDeg(Lp) * DEG2RAD;
  const DR = normalizeDeg(D) * DEG2RAD;
  const MR = normalizeDeg(M) * DEG2RAD;
  const MpR = normalizeDeg(Mp) * DEG2RAD;
  const FR = normalizeDeg(F) * DEG2RAD;

  // Accumulate periodic terms.
  let sigmaL = 0; // 10⁻⁶ degrees
  let sigmaR = 0; // 10⁻³ km
  let sigmaB = 0; // 10⁻⁶ degrees

  for (let i = 0; i < MOON_LON_DIST_TERMS.length; i++) {
    const t = MOON_LON_DIST_TERMS[i]!;
    const arg = t.d * DR + t.m * MR + t.mp * MpR + t.f * FR;
    // Eccentricity correction for |m| = 1 → ×E, |m| = 2 → ×E².
    const eFac = Math.abs(t.m) === 1 ? E : Math.abs(t.m) === 2 ? E * E : 1;
    sigmaL += t.sigL * eFac * Math.sin(arg);
    sigmaR += t.sigR * eFac * Math.cos(arg);
  }
  for (let i = 0; i < MOON_LAT_TERMS.length; i++) {
    const t = MOON_LAT_TERMS[i]!;
    const arg = t.d * DR + t.m * MR + t.mp * MpR + t.f * FR;
    const eFac = Math.abs(t.m) === 1 ? E : Math.abs(t.m) === 2 ? E * E : 1;
    sigmaB += t.sigB * eFac * Math.sin(arg);
  }

  // Apparent geocentric longitude, latitude, distance.
  const lambdaDeg = Lp + sigmaL / 1_000_000;
  const betaDeg = sigmaB / 1_000_000;
  // Distance: Meeus p. 342: Δ (km) = 385000.56 + Σr / 1000.
  const distanceKm = 385000.56 + sigmaR / 1000;

  const lambdaRad = normalizeAngleRad(lambdaDeg * DEG2RAD);
  const betaRad = betaDeg * DEG2RAD;

  // Convert ecliptic → equatorial. Obliquity with leading nutation
  // correction (Meeus p. 144).
  const omegaDeg = 125.04452 - 1934.136261 * T;
  const epsRad = meanObliquityRad(T) + 0.00256 * DEG2RAD * Math.cos(omegaDeg * DEG2RAD);

  const cosBeta = Math.cos(betaRad);
  const sinBeta = Math.sin(betaRad);
  const cosLambda = Math.cos(lambdaRad);
  const sinLambda = Math.sin(lambdaRad);
  const cosEps = Math.cos(epsRad);
  const sinEps = Math.sin(epsRad);

  // Meeus eqs. 13.3, 13.4 (ecliptic → equatorial).
  const raRad = normalizeAngleRad(
    Math.atan2(sinLambda * cosEps - (sinBeta / cosBeta) * sinEps, cosLambda),
  );
  const decRad = Math.asin(
    Math.max(-1, Math.min(1, sinBeta * cosEps + cosBeta * sinEps * sinLambda)),
  );

  // Illuminated fraction (Meeus Ch. 48).
  // Phase angle i ≈ 180° − D + Meeus eq. 48.4 small corrections.
  //   i = 180° − D − 6.289° sin M' + 2.100° sin M − 1.274° sin(2D − M')
  //       − 0.658° sin(2D) − 0.214° sin(2M') − 0.110° sin D
  const iDeg =
    180 -
    (D - Math.floor(D / 360) * 360) -
    6.289 * Math.sin(MpR) +
    2.1 * Math.sin(MR) -
    1.274 * Math.sin(2 * DR - MpR) -
    0.658 * Math.sin(2 * DR) -
    0.214 * Math.sin(2 * MpR) -
    0.11 * Math.sin(DR);
  const iRad = iDeg * DEG2RAD;
  // Meeus eq. 48.1.
  const phase = (1 + Math.cos(iRad)) / 2;

  // Angular diameter: Moon's mean semidiameter at distance Δ is
  // s = 358473400" / Δ_km (Meeus p. 390 gives s in arcsec from parallax;
  // equivalently diameter ≈ 2 · atan(R_moon / Δ). Using the simpler
  // Meeus p. 391: s(arcsec) = 358473400 / Δ_km → diameter = 2s.
  const semidiamArcsec = 358473400 / distanceKm;
  const angularDiameterArcsec = 2 * semidiamArcsec;

  return { raRad, decRad, phase, angularDiameterArcsec };
}

// Re-export JD_J2000 etc for convenience; tests may import it.
export { JD_J2000, julianDate };
