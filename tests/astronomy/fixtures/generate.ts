// One-shot fixture generator for the astronomy reference tests.
//
// Purpose: use the `astronomy-engine` npm package (an MIT-licensed,
// NASA/JPL-derived ephemeris library accurate to arc-seconds) to
// compute the ground-truth altitudes/azimuths/magnitudes/phase for
// each of our 5 observation fixtures, then write them to JSON.
// The tests at `tests/astronomy/*.test.ts` load these JSON files and
// compare the outputs of `src/astro/*` against them.
//
// Run with:
//   npx tsx tests/astronomy/fixtures/generate.ts
//
// Output: fixtures/{moore-hall-1969,quito-equinox,longyearbyen-midnight-sun,
//                   mcmurdo-midday-sun,sydney-crux}.json
//
// Notes on the API:
//   - `Horizon(time, observer, raHours, decDeg, 'normal')` projects an
//     apparent RA/Dec (of-date) to alt/az with the standard refraction
//     model. We use `'normal'` to match our Bennett-formula refraction.
//   - For stars catalogued at J2000 mean equator (which is how our
//     anchor list is specified), we rotate the J2000 equatorial vector
//     into the horizontal frame via `Rotation_EQJ_HOR` +
//     `HorizonFromVector(..., 'normal')`. This is the library-correct
//     way to handle J2000 catalogue coordinates — using `Horizon`
//     directly with J2000 RA/Dec would be wrong by ~precession.
//   - `Equator(Body, time, observer, ofdate=true, aberration=true)`
//     gives the apparent topocentric RA/Dec, which is what we want
//     to compare our geocentric Sun/Moon/planet results against.
//     (Topocentric vs geocentric differs by <1 arcsec for the Sun
//     and planets; for the Moon it can be ~1°, see fixture comments.)

import {
  Body,
  EquatorFromVector,
  GeoMoon,
  GeoVector,
  Horizon,
  HorizonFromVector,
  Illumination,
  MakeTime,
  Observer,
  RotateVector,
  Rotation_EQJ_EQD,
  Rotation_EQJ_HOR,
  Spherical,
  VectorFromSphere,
} from 'astronomy-engine';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------
// Fixture definitions
// ---------------------------------------------------------------------

interface FixtureInput {
  name: string;
  filename: string;
  utcInstant: string;
  localDate: string;
  localTime: string;
  timeZone: string;
  utcOffsetMinutes: number;
  location: { lat: number; lon: number; label: string };
  bearingDeg: number;
  fovDeg: number;
}

const FIXTURES: FixtureInput[] = [
  {
    name: 'moore-hall-1969',
    filename: 'moore-hall-1969.json',
    utcInstant: '1969-12-13T05:00:00.000Z',
    localDate: '1969-12-13',
    localTime: '00:00',
    timeZone: 'America/New_York',
    utcOffsetMinutes: -300,
    location: { lat: 43.7044, lon: -72.2887, label: 'Moore Hall, Dartmouth College, Hanover, NH' },
    bearingDeg: 0,
    fovDeg: 90,
  },
  {
    name: 'quito-equinox',
    filename: 'quito-equinox.json',
    utcInstant: '2000-03-20T17:00:00.000Z',
    localDate: '2000-03-20',
    localTime: '12:00',
    timeZone: 'America/Guayaquil',
    utcOffsetMinutes: -300,
    location: { lat: 0.0, lon: -78.5, label: 'Quito, Ecuador (equinox noon)' },
    bearingDeg: 0,
    fovDeg: 90,
  },
  {
    name: 'longyearbyen-midnight-sun',
    filename: 'longyearbyen-midnight-sun.json',
    utcInstant: '2020-06-20T23:00:00.000Z',
    localDate: '2020-06-21',
    localTime: '01:00',
    timeZone: 'Europe/Oslo',
    utcOffsetMinutes: 120,
    location: { lat: 78.2, lon: 15.6, label: 'Longyearbyen, Svalbard (midnight sun)' },
    bearingDeg: 0,
    fovDeg: 90,
  },
  {
    name: 'mcmurdo-midday-sun',
    filename: 'mcmurdo-midday-sun.json',
    utcInstant: '2020-12-20T12:00:00.000Z',
    localDate: '2020-12-21',
    localTime: '01:00',
    timeZone: 'Antarctica/McMurdo',
    utcOffsetMinutes: 780,
    location: { lat: -77.8, lon: 166.7, label: 'McMurdo Station, Antarctica (midday sun)' },
    bearingDeg: 0,
    fovDeg: 90,
  },
  {
    name: 'sydney-crux',
    filename: 'sydney-crux.json',
    utcInstant: '2024-12-31T13:00:00.000Z',
    localDate: '2025-01-01',
    localTime: '00:00',
    timeZone: 'Australia/Sydney',
    utcOffsetMinutes: 660,
    location: { lat: -33.9, lon: 151.2, label: 'Sydney, Australia (New Year midnight)' },
    bearingDeg: 0,
    fovDeg: 90,
  },
];

interface AnchorStar {
  name: string;
  raDeg: number;
  decDeg: number;
}

// Anchor stars, RA/Dec J2000 in degrees (from task brief).
const ANCHOR_STARS: AnchorStar[] = [
  { name: 'Polaris', raDeg: 37.955, decDeg: 89.264 },
  { name: 'Vega', raDeg: 279.234, decDeg: 38.784 },
  { name: 'Sirius', raDeg: 101.287, decDeg: -16.716 },
  { name: 'Betelgeuse', raDeg: 88.793, decDeg: 7.407 },
  { name: 'Rigel', raDeg: 78.634, decDeg: -8.202 },
  { name: 'Arcturus', raDeg: 213.915, decDeg: 19.182 },
  { name: 'Capella', raDeg: 79.172, decDeg: 45.998 },
  { name: 'Aldebaran', raDeg: 68.980, decDeg: 16.509 },
  { name: 'Procyon', raDeg: 114.826, decDeg: 5.225 },
  { name: 'Altair', raDeg: 297.696, decDeg: 8.868 },
];

const PLANETS: { name: string; body: Body }[] = [
  { name: 'Mercury', body: Body.Mercury },
  { name: 'Venus', body: Body.Venus },
  { name: 'Mars', body: Body.Mars },
  { name: 'Jupiter', body: Body.Jupiter },
  { name: 'Saturn', body: Body.Saturn },
  { name: 'Uranus', body: Body.Uranus },
  { name: 'Neptune', body: Body.Neptune },
];

// ---------------------------------------------------------------------
// Compute helpers
// ---------------------------------------------------------------------

// Astronomy-engine km per AU — needed for moon angular diameter.
const KM_PER_AU = 149_597_870.7;
const MOON_RADIUS_KM = 1737.4;

function starAltAz(
  raJ2000Deg: number,
  decJ2000Deg: number,
  time: ReturnType<typeof MakeTime>,
  observer: Observer,
): { altDegGeometric: number; altDegApparent: number; azDeg: number } {
  // Rotate the J2000 equatorial unit vector into the local horizontal
  // frame at the observer's position. This path is correct for
  // catalogue-coordinate stars (the inputs here are referred to J2000
  // mean equator), because Rotation_EQJ_HOR composes the precession,
  // nutation, diurnal rotation, and observer-geometry steps for us.
  //
  // We record BOTH:
  //   - geometric: unrefracted (null refraction option in library).
  //     This is the best reference for alt/az *geometry* — the library
  //     disagrees with our code only on refraction model below the
  //     horizon, and we want to test geometry independently.
  //   - apparent:  with 'normal' (Saemundsson) refraction — useful for
  //     above-horizon visual comparisons; we do not assert against
  //     this below the horizon because refraction models diverge
  //     unphysically for deep-negative altitudes.
  const vecEqj = VectorFromSphere(new Spherical(decJ2000Deg, raJ2000Deg, 1), time);
  const rot = Rotation_EQJ_HOR(time, observer);
  const vecHor = RotateVector(rot, vecEqj);
  // astronomy-engine's .d.ts narrows refraction to `string`, but its runtime
// accepts `null` (meaning "no refraction"), which is the correct way to get
// a pure-geometric altitude. Cast through `any` to match the true API.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const horGeom = HorizonFromVector(vecHor, null as any);
  const horApp = HorizonFromVector(vecHor, 'normal');
  return {
    altDegGeometric: horGeom.lat,
    altDegApparent: horApp.lat,
    // Azimuth is refraction-independent.
    azDeg: horGeom.lon,
  };
}

// Geocentric RA/Dec of-date for a Solar-System body. Matches the
// convention used by our src/astro/sun-moon.ts and src/astro/planets.ts
// (which return geocentric apparent positions). For the Sun and
// planets, topocentric ≈ geocentric within <1 arcsec; for the Moon
// the difference is up to ~1° (parallax), so this distinction is
// essential to get a fair comparison.
function geocentricRaDecOfDate(
  body: Body,
  time: ReturnType<typeof MakeTime>,
): { raHours: number; decDeg: number } {
  const gvJ2000 = GeoVector(body, time, /* aberration */ true);
  const rot = Rotation_EQJ_EQD(time);
  const gvOfDate = RotateVector(rot, gvJ2000);
  const eq = EquatorFromVector(gvOfDate);
  return { raHours: eq.ra, decDeg: eq.dec };
}

function sunAltAz(
  time: ReturnType<typeof MakeTime>,
  observer: Observer,
): {
  altDegGeometric: number;
  altDegApparent: number;
  azDeg: number;
  raHours: number;
  decDeg: number;
} {
  const { raHours, decDeg } = geocentricRaDecOfDate(Body.Sun, time);
  // astronomy-engine's .d.ts narrows refraction to `string | undefined`, but
// its runtime accepts `null` (meaning "no refraction"). Cast to match.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hGeom = Horizon(time, observer, raHours, decDeg, null as any);
  const hApp = Horizon(time, observer, raHours, decDeg, 'normal');
  return {
    altDegGeometric: hGeom.altitude,
    altDegApparent: hApp.altitude,
    azDeg: hGeom.azimuth,
    raHours,
    decDeg,
  };
}

function moonAltAzPhase(
  time: ReturnType<typeof MakeTime>,
  observer: Observer,
): {
  altDegGeometric: number;
  altDegApparent: number;
  azDeg: number;
  phase: number;
  angularDiameterArcsec: number;
} {
  const { raHours, decDeg } = geocentricRaDecOfDate(Body.Moon, time);
  // astronomy-engine's .d.ts narrows refraction to `string | undefined`, but
// its runtime accepts `null` (meaning "no refraction"). Cast to match.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hGeom = Horizon(time, observer, raHours, decDeg, null as any);
  const hApp = Horizon(time, observer, raHours, decDeg, 'normal');
  const illum = Illumination(Body.Moon, time);
  // Angular diameter from the geocentric distance vector (the
  // difference between geocentric and topocentric Moon distance is
  // ~1.5% at most — we accept that in the reference because our own
  // src/astro/sun-moon.ts returns a geocentric angular diameter too).
  const geo = GeoMoon(time);
  const distAU = Math.sqrt(geo.x * geo.x + geo.y * geo.y + geo.z * geo.z);
  const distKm = distAU * KM_PER_AU;
  const angDiamArcsec = 2 * Math.atan(MOON_RADIUS_KM / distKm) * (180 / Math.PI) * 3600;
  return {
    altDegGeometric: hGeom.altitude,
    altDegApparent: hApp.altitude,
    azDeg: hGeom.azimuth,
    phase: illum.phase_fraction,
    angularDiameterArcsec: angDiamArcsec,
  };
}

function planetAltAzMag(
  body: Body,
  time: ReturnType<typeof MakeTime>,
  observer: Observer,
): {
  altDegGeometric: number;
  altDegApparent: number;
  azDeg: number;
  apparentMag: number;
} {
  const { raHours, decDeg } = geocentricRaDecOfDate(body, time);
  // astronomy-engine's .d.ts narrows refraction to `string | undefined`, but
// its runtime accepts `null` (meaning "no refraction"). Cast to match.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hGeom = Horizon(time, observer, raHours, decDeg, null as any);
  const hApp = Horizon(time, observer, raHours, decDeg, 'normal');
  const illum = Illumination(body, time);
  return {
    altDegGeometric: hGeom.altitude,
    altDegApparent: hApp.altitude,
    azDeg: hGeom.azimuth,
    apparentMag: illum.mag,
  };
}

// ---------------------------------------------------------------------
// Build fixture payloads
// ---------------------------------------------------------------------

interface StarExpectation {
  name: string;
  raDeg: number;
  decDeg: number;
  expected: {
    altDegGeometric: number;
    altDegApparent: number;
    azDeg: number;
  };
}

interface PlanetExpectation {
  name: string;
  expected: {
    altDegGeometric: number;
    altDegApparent: number;
    azDeg: number;
    apparentMag: number;
  };
}

interface FixtureOutput {
  name: string;
  observation: {
    utcInstant: string;
    localDate: string;
    localTime: string;
    timeZone: string;
    utcOffsetMinutes: number;
    location: { lat: number; lon: number; label: string };
    bearingDeg: number;
    fovDeg: number;
  };
  stars: StarExpectation[];
  sun: {
    expected: {
      altDegGeometric: number;
      altDegApparent: number;
      azDeg: number;
      raHours: number;
      decDeg: number;
    };
  };
  moon: {
    expected: {
      altDegGeometric: number;
      altDegApparent: number;
      azDeg: number;
      phase: number;
      angularDiameterArcsec: number;
    };
  };
  planets: PlanetExpectation[];
}

function buildFixture(f: FixtureInput): FixtureOutput {
  const time = MakeTime(new Date(f.utcInstant));
  const observer = new Observer(f.location.lat, f.location.lon, 0);

  const stars: StarExpectation[] = ANCHOR_STARS.map((s) => ({
    name: s.name,
    raDeg: s.raDeg,
    decDeg: s.decDeg,
    expected: starAltAz(s.raDeg, s.decDeg, time, observer),
  }));

  const sun = { expected: sunAltAz(time, observer) };
  const moon = { expected: moonAltAzPhase(time, observer) };

  const planets: PlanetExpectation[] = PLANETS.map((p) => ({
    name: p.name,
    expected: planetAltAzMag(p.body, time, observer),
  }));

  return {
    name: f.name,
    observation: {
      utcInstant: f.utcInstant,
      localDate: f.localDate,
      localTime: f.localTime,
      timeZone: f.timeZone,
      utcOffsetMinutes: f.utcOffsetMinutes,
      location: f.location,
      bearingDeg: f.bearingDeg,
      fovDeg: f.fovDeg,
    },
    stars,
    sun,
    moon,
    planets,
  };
}

// ---------------------------------------------------------------------
// Write JSON outputs
// ---------------------------------------------------------------------

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  mkdirSync(here, { recursive: true });

  for (const f of FIXTURES) {
    const payload = buildFixture(f);
    const outPath = resolve(here, f.filename);
    writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    // eslint-disable-next-line no-console
    console.log(`wrote ${outPath}`);
  }
}

main();
