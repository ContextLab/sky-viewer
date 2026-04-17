// Planetary positions (Mercury through Neptune).
//
// References (cited inline):
//   Meeus, J. "Astronomical Algorithms", 2nd ed. 1998 (Willmann-Bell).
//     Ch. 31 — Positions of the Planets (classical mean orbital elements)
//               Tables 31.A (J2000.0 elements), 31.B (linear rates).
//     Ch. 32 — Elliptic Motion (Kepler's equation)
//     Ch. 33 — Reduction of elements / apparent position
//     Ch. 41 — Illuminated Fraction and Magnitude of the Planets
//     Ch. 23 — Reduction of the Ecliptic Coordinates
//
// Approach (allowed by research.md R2 "alternative if VSOP87 feels too
// heavy"): use the mean-orbital-elements tables of Meeus Ch. 31. For
// each planet and Earth, compute heliocentric ecliptic rectangular
// coordinates at the J2000.0 mean ecliptic, subtract to get geocentric
// coordinates, convert to RA/Dec. Apparent magnitude per Meeus Ch. 41.
//
// Accuracy at ±100 years from J2000 is roughly arc-minute scale, well
// under the 0.1° target (research.md R2).
//
// NB: All angles stored internally in radians. Meeus tables give
// elements in degrees and centuries-since-J2000 polynomials; we convert
// on load.

import { julianCenturiesJ2000, julianDate, JD_J2000 } from './time';

type PlanetId =
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune';

export type VisiblePlanet = Exclude<PlanetId, 'earth'>;

const DEG2RAD = Math.PI / 180;
const TAU = Math.PI * 2;

function normalizeAngleRad(rad: number): number {
  const m = rad % TAU;
  return m < 0 ? m + TAU : m;
}

function meanObliquityRad(T: number): number {
  // Meeus eq. 22.2.
  const eps0Arcsec =
    23 * 3600 + 26 * 60 + 21.448 + (-46.8150 + (-0.00059 + 0.001813 * T) * T) * T;
  return (eps0Arcsec / 3600) * DEG2RAD;
}

/**
 * Mean orbital elements of the planets referred to the J2000.0 mean
 * ecliptic and equinox. Source: Meeus "Astronomical Algorithms" 2nd
 * ed., Ch. 31 Table 31.A (J2000.0 values) with linear-in-T rates
 * from Table 31.B. Extracted verbatim from the textbook (public
 * astronomical data, no licence issue).
 *
 * Polynomial form: element(T) = a0 + a1·T + a2·T² + a3·T³,
 * where T is Julian centuries from J2000.0.
 *
 * Units:
 *   L, omegaBar (= ω + Ω), Omega, i — degrees
 *   a                                — AU
 *   e                                — dimensionless
 *
 * Note: we store mean longitude L and longitude of perihelion ϖ
 * (omegaBar). Argument of perihelion ω = ϖ − Ω. Mean anomaly
 * M = L − ϖ.
 */
interface MeanElements {
  // L — mean longitude (deg)
  L: [number, number, number, number];
  // a — semimajor axis (AU); essentially constant over millennia
  a: [number, number, number, number];
  // e — eccentricity
  e: [number, number, number, number];
  // i — inclination to J2000 ecliptic (deg)
  i: [number, number, number, number];
  // Ω — longitude of ascending node (deg)
  Omega: [number, number, number, number];
  // ϖ — longitude of perihelion (deg)
  omegaBar: [number, number, number, number];
}

// Meeus Table 31.A (J2000.0 ecliptic, J2000 elements, cubic polynomial
// coefficients). Values transcribed from the 2nd edition. The table
// gives L, a, e, i, Ω, ϖ as polynomials in T with units degrees / AU.
//
// Reviewers: these numbers are textbook — please audit against a copy
// of Meeus Ch. 31 Table 31.A (pp. 212–215 of the 2nd ed.).
const ELEMENTS: Record<PlanetId, MeanElements> = {
  mercury: {
    L: [252.250906, 149474.0722491, 0.0003035, 0.000000018],
    a: [0.387098310, 0, 0, 0],
    e: [0.20563175, 0.000020407, -0.0000000283, -0.00000000018],
    i: [7.004986, 0.0018215, -0.00001810, 0.000000056],
    Omega: [48.330893, 1.1861883, 0.00017542, 0.000000215],
    omegaBar: [77.456119, 1.5564776, 0.00029544, 0.000000009],
  },
  venus: {
    L: [181.979801, 58519.2130302, 0.00031014, 0.000000015],
    a: [0.72332982, 0, 0, 0],
    e: [0.00677188, -0.000047766, 0.0000000975, 0.00000000044],
    i: [3.394662, 0.0010037, -0.00000088, -0.000000007],
    Omega: [76.679920, 0.9011206, 0.00040618, -0.000000093],
    omegaBar: [131.563703, 1.4022288, -0.00107618, -0.000005678],
  },
  earth: {
    L: [100.466449, 36000.7698231, 0.00030368, 0.000000021],
    a: [1.000001018, 0, 0, 0],
    e: [0.01670862, -0.000042037, -0.0000001236, 0.00000000004],
    i: [0, 0, 0, 0],
    // Ω undefined when i = 0; place-holder value irrelevant.
    Omega: [0, 0, 0, 0],
    omegaBar: [102.937348, 1.7195269, 0.00045962, 0.000000499],
  },
  mars: {
    L: [355.433275, 19141.6964746, 0.00031097, 0.000000015],
    a: [1.523679342, 0, 0, 0],
    e: [0.09340062, 0.000090483, -0.0000000806, -0.00000000035],
    i: [1.849726, -0.0006011, 0.00001276, -0.000000007],
    Omega: [49.558093, 0.7720959, 0.00001557, 0.000002267],
    omegaBar: [336.060234, 1.8410449, 0.00013477, 0.000000536],
  },
  jupiter: {
    L: [34.351484, 3036.3027889, 0.00022374, 0.000000025],
    a: [5.202603191, 0.0000001913, 0, 0],
    e: [0.04849485, 0.000163244, -0.0000004719, -0.00000000197],
    i: [1.303270, -0.0054966, 0.00000465, -0.000000004],
    Omega: [100.464441, 1.0209550, 0.00040117, 0.000000569],
    omegaBar: [14.331309, 1.6126668, 0.00103127, -0.000004569],
  },
  saturn: {
    L: [50.077471, 1223.5110141, 0.00051952, -0.000000003],
    a: [9.554909596, -0.0000021389, 0, 0],
    e: [0.05550862, -0.000346818, -0.0000006456, 0.00000000338],
    i: [2.488878, -0.0037363, -0.00001516, 0.000000089],
    Omega: [113.665524, 0.8770979, -0.00012067, -0.000002380],
    omegaBar: [93.056787, 1.9637694, 0.00083757, 0.000004899],
  },
  uranus: {
    L: [314.055005, 429.8640561, 0.00030434, 0.000000026],
    a: [19.218446062, -0.0000000372, 0.00000000098, 0],
    e: [0.04629590, -0.000027337, 0.0000000790, 0.00000000025],
    i: [0.773196, 0.0007744, 0.00003749, -0.000000092],
    Omega: [74.005947, 0.5211258, 0.00133982, 0.000018516],
    omegaBar: [173.005159, 1.4863784, 0.00021450, 0.000000433],
  },
  neptune: {
    L: [304.348665, 219.8833092, 0.00030926, 0.000000018],
    a: [30.110386869, -0.0000001663, 0.00000000069, 0],
    e: [0.00898809, 0.000006408, -0.0000000008, 0],
    i: [1.769952, -0.0093082, -0.00000708, 0.000000028],
    Omega: [131.784057, 1.1022057, 0.00026006, -0.000000636],
    omegaBar: [48.123691, 1.4262677, 0.00037918, -0.000000003],
  },
};

function evalPoly(coeffs: [number, number, number, number], T: number): number {
  return coeffs[0] + T * (coeffs[1] + T * (coeffs[2] + T * coeffs[3]));
}

/**
 * Solve Kepler's equation M = E − e·sin(E) for the eccentric
 * anomaly E, given mean anomaly M (rad) and eccentricity e.
 * Newton-Raphson with 5 iterations converges to <1e-12 rad for
 * e < 0.3 (all planets except Mercury at e≈0.21 — still converges).
 * Meeus Ch. 32, eq. 32.5 / 32.6.
 */
function solveKepler(M: number, e: number): number {
  // Reduce M to [−π, π] for stable Newton start.
  let Mr = M % TAU;
  if (Mr > Math.PI) Mr -= TAU;
  if (Mr < -Math.PI) Mr += TAU;
  let E = Mr + e * Math.sin(Mr); // first-order approximation, Meeus p. 196
  for (let k = 0; k < 8; k++) {
    const f = E - e * Math.sin(E) - Mr;
    const fp = 1 - e * Math.cos(E);
    const dE = f / fp;
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/**
 * Heliocentric ecliptic rectangular coordinates of a planet at time
 * `utcMs`, referred to the mean ecliptic and equinox of J2000.0.
 *
 * Algorithm (Meeus Ch. 32 "Motion in an elliptic orbit" §31 ex. 32.a):
 *   1. Evaluate mean elements at T.
 *   2. M = L − ϖ  (mean anomaly).
 *   3. ω = ϖ − Ω  (argument of perihelion).
 *   4. Solve Kepler for eccentric anomaly E.
 *   5. True anomaly ν, heliocentric distance r:
 *        r = a(1 − e cos E)
 *        tan(ν/2) = √((1+e)/(1−e)) · tan(E/2)
 *   6. Heliocentric ecliptic rectangular (Meeus eq. 33.2, adapted):
 *        u = ν + ω   (argument of latitude from node)
 *        x = r · (cos Ω cos u − sin Ω sin u cos i)
 *        y = r · (sin Ω cos u + cos Ω sin u cos i)
 *        z = r · (sin u sin i)
 */
function heliocentricXYZ(
  body: PlanetId,
  T: number,
): { x: number; y: number; z: number; r: number } {
  // `noUncheckedIndexedAccess` widens Record access; body is a
  // literal union so this is always defined — non-null assert.
  const el = ELEMENTS[body]!;
  const LDeg = evalPoly(el.L, T);
  const aAU = evalPoly(el.a, T);
  const e = evalPoly(el.e, T);
  const iDeg = evalPoly(el.i, T);
  const OmegaDeg = evalPoly(el.Omega, T);
  const piDeg = evalPoly(el.omegaBar, T);

  const L = normalizeAngleRad(LDeg * DEG2RAD);
  const pi = normalizeAngleRad(piDeg * DEG2RAD);
  const Om = normalizeAngleRad(OmegaDeg * DEG2RAD);
  const inc = iDeg * DEG2RAD;
  const M = L - pi;
  const omega = pi - Om;

  const E = solveKepler(M, e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const r = aAU * (1 - e * cosE);
  // True anomaly via the more numerically-stable atan2 form:
  //   sin ν = √(1−e²) · sin E / (1 − e cos E)
  //   cos ν = (cos E − e) / (1 − e cos E)
  const sinNu = (Math.sqrt(1 - e * e) * sinE) / (1 - e * cosE);
  const cosNu = (cosE - e) / (1 - e * cosE);
  const nu = Math.atan2(sinNu, cosNu);

  const u = nu + omega; // argument of latitude
  const cosU = Math.cos(u);
  const sinU = Math.sin(u);
  const cosOm = Math.cos(Om);
  const sinOm = Math.sin(Om);
  const cosI = Math.cos(inc);
  const sinI = Math.sin(inc);

  const x = r * (cosOm * cosU - sinOm * sinU * cosI);
  const y = r * (sinOm * cosU + cosOm * sinU * cosI);
  const z = r * (sinU * sinI);
  return { x, y, z, r };
}

/**
 * Apparent magnitude of a planet.
 *
 * Meeus Ch. 41 pp. 285–286 gives the following expressions (AA87 /
 * Astronomical Almanac fits), where r = heliocentric distance (AU),
 * Δ = geocentric distance (AU), i = phase angle (degrees):
 *
 *   Mercury:  V = −0.42 + 5 log(rΔ) + 0.0380·i − 0.000273·i² + 0.000002·i³
 *   Venus:    V = −4.40 + 5 log(rΔ) + 0.0009·i  + 0.000239·i² − 0.00000065·i³
 *   Mars:     V = −1.52 + 5 log(rΔ) + 0.016·i
 *   Jupiter:  V = −9.40 + 5 log(rΔ) + 0.005·i
 *   Saturn:   V = −8.88 + 5 log(rΔ)            (ring contribution omitted
 *                                               — up to ~0.7 mag swing
 *                                               but acceptable for tier)
 *   Uranus:   V = −7.19 + 5 log(rΔ)
 *   Neptune:  V = −6.87 + 5 log(rΔ)
 */
function apparentMagnitude(body: VisiblePlanet, r: number, Delta: number, iDeg: number): number {
  const base = 5 * Math.log10(r * Delta);
  switch (body) {
    case 'mercury':
      return -0.42 + base + 0.0380 * iDeg - 0.000273 * iDeg * iDeg + 0.000002 * iDeg * iDeg * iDeg;
    case 'venus':
      return (
        -4.40 +
        base +
        0.0009 * iDeg +
        0.000239 * iDeg * iDeg -
        0.00000065 * iDeg * iDeg * iDeg
      );
    case 'mars':
      return -1.52 + base + 0.016 * iDeg;
    case 'jupiter':
      return -9.40 + base + 0.005 * iDeg;
    case 'saturn':
      return -8.88 + base;
    case 'uranus':
      return -7.19 + base;
    case 'neptune':
      return -6.87 + base;
  }
}

/**
 * Geocentric apparent position of a major planet.
 *
 * Pipeline:
 *   1. Heliocentric X,Y,Z of Earth and of the target (ecliptic J2000).
 *   2. Geocentric X,Y,Z = X_planet − X_earth.
 *   3. Geocentric ecliptic longitude/latitude, distance Δ.
 *   4. Light-time correction: recompute target position at t − Δ/c.
 *      (Meeus Ch. 33 p. 224. We iterate once, which is plenty for our
 *      accuracy tier.)
 *   5. Rotate ecliptic → equatorial using J2000 mean obliquity, then
 *      apply a small T-dependent correction for the epoch-of-date
 *      obliquity. (For <0.1° accuracy we treat the output as referred
 *      to J2000 equator; the precession rotation to epoch-of-date is
 *      handled downstream when needed. Note: Meeus Ch. 31 elements
 *      are already referred to J2000 ecliptic — so RA/Dec here are
 *      mean J2000; for apparent RA/Dec at epoch of date, pipe through
 *      transforms.precessStarToEpoch in the caller, OR accept the
 *      sub-arcminute discrepancy over 1900–2100.)
 *   6. Apparent magnitude via Meeus Ch. 41.
 *
 * Speed of light in AU/day (Meeus p. 224): c = 173.14463 AU/day.
 */
const LIGHT_SPEED_AU_PER_DAY = 173.14463;

export function planetPosition(
  body: VisiblePlanet,
  utcMs: number,
): { raRad: number; decRad: number; apparentMag: number } {
  // Earth position at observation time.
  const T0 = julianCenturiesJ2000(utcMs);
  const earth0 = heliocentricXYZ('earth', T0);

  // First estimate of geocentric vector (no light-time correction).
  let planet = heliocentricXYZ(body, T0);
  let dx = planet.x - earth0.x;
  let dy = planet.y - earth0.y;
  let dz = planet.z - earth0.z;
  let Delta = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Light-time correction: compute target at t − τ, where τ = Δ / c
  // in days (Meeus Ch. 33 "Aberration and light-time").
  const tauDays = Delta / LIGHT_SPEED_AU_PER_DAY;
  const Ttau = T0 - tauDays / 36525;
  planet = heliocentricXYZ(body, Ttau);
  dx = planet.x - earth0.x;
  dy = planet.y - earth0.y;
  dz = planet.z - earth0.z;
  Delta = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Geocentric ecliptic longitude/latitude of the planet (radians),
  // referred to J2000.0 mean ecliptic.
  const lambda = Math.atan2(dy, dx);
  const beta = Math.atan2(dz, Math.sqrt(dx * dx + dy * dy));

  // Rotate ecliptic → equatorial. Use the mean obliquity at epoch of
  // date (not J2000) so results are referred to epoch-of-date equator
  // to the accuracy of the ecliptic/equator tilt drift only
  // (~46"/century, dominated by precession). This is the cheapest
  // path that matches Stellarium at the ~arcmin level over 1900–2100.
  const eps = meanObliquityRad(T0);
  const sinB = Math.sin(beta);
  const cosB = Math.cos(beta);
  const sinL = Math.sin(lambda);
  const cosL = Math.cos(lambda);
  const sinE = Math.sin(eps);
  const cosE = Math.cos(eps);

  // Meeus eqs. 13.3, 13.4.
  const raRad = normalizeAngleRad(Math.atan2(sinL * cosE - (sinB / cosB) * sinE, cosL));
  const decRad = Math.asin(Math.max(-1, Math.min(1, sinB * cosE + cosB * sinE * sinL)));

  // Phase angle i for magnitude (Meeus eq. 41.3):
  //   cos i = (r² + Δ² − R²) / (2 r Δ)
  // where r = heliocentric distance of planet, R = heliocentric
  // distance of Earth.
  const rHelio = planet.r;
  const REarth = Math.sqrt(earth0.x * earth0.x + earth0.y * earth0.y + earth0.z * earth0.z);
  const cosPhase = (rHelio * rHelio + Delta * Delta - REarth * REarth) / (2 * rHelio * Delta);
  const phaseDeg = Math.acos(Math.max(-1, Math.min(1, cosPhase))) * (180 / Math.PI);

  const apparentMag = apparentMagnitude(body, rHelio, Delta, phaseDeg);

  return { raRad, decRad, apparentMag };
}

// Internal helpers are exported under underscore-prefix for tests that
// might want to stub them. Public surface is `planetPosition`.
export const _internal = {
  heliocentricXYZ,
  solveKepler,
  apparentMagnitude,
  julianDate,
  JD_J2000,
  ELEMENTS,
};
