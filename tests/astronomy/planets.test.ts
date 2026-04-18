// T029 — Verify planetPosition against astronomy-engine for each of
// Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune.
//
// Tolerance: 0.2° for alt/az (planets use mean-element theory and
// are harder than stars under our VSOP-free truncation). Magnitude
// within 0.5 mag.
//
// Only assert when the planet is above the horizon (alt > 0° in the
// reference). Below-horizon planets are not observable and the
// reference refraction model diverges from ours (see sun-moon /
// transforms tests for the full explanation).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { equatorialToHorizontal } from '../../src/astro/transforms';
import { planetPosition, type VisiblePlanet } from '../../src/astro/planets';

const DEG2RAD = Math.PI / 180;

function angleDiffDeg(a: number, b: number): number {
  let d = ((a - b) % 360 + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

function applyBennett(altDeg: number): number {
  if (altDeg <= -1) return altDeg;
  const argDeg = altDeg + 7.31 / (altDeg + 4.4);
  const Rarcmin = 1 / Math.tan(argDeg * DEG2RAD);
  return altDeg + Rarcmin / 60;
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
    location: { lat: number; lon: number };
  };
  planets: PlanetExpectation[];
}

const FIXTURE_NAMES = [
  'moore-hall-1969',
  'quito-equinox',
  'longyearbyen-midnight-sun',
  'mcmurdo-midday-sun',
  'sydney-crux',
] as const;

function loadFixture(name: string): FixtureOutput {
  const here = dirname(fileURLToPath(import.meta.url));
  const p = resolve(here, 'fixtures', `${name}.json`);
  return JSON.parse(readFileSync(p, 'utf8')) as FixtureOutput;
}

const PLANET_NAME_MAP: Record<string, VisiblePlanet> = {
  Mercury: 'mercury',
  Venus: 'venus',
  Mars: 'mars',
  Jupiter: 'jupiter',
  Saturn: 'saturn',
  Uranus: 'uranus',
  Neptune: 'neptune',
};

const POS_TOLERANCE_DEG = 0.2;
const MAG_TOLERANCE = 0.5;

describe('planetPosition — 5 fixtures × 7 visible planets (above-horizon)', () => {
  for (const fname of FIXTURE_NAMES) {
    const fixture = loadFixture(fname);
    const utcMs = Date.parse(fixture.observation.utcInstant);
    const latRad = fixture.observation.location.lat * DEG2RAD;
    const lonRad = fixture.observation.location.lon * DEG2RAD;

    describe(fname, () => {
      for (const p of fixture.planets) {
        const body = PLANET_NAME_MAP[p.name];
        if (!body) throw new Error(`Unknown planet ${p.name}`);

        it(`${p.name} magnitude within ${MAG_TOLERANCE}`, () => {
          const { apparentMag } = planetPosition(body, utcMs);
          const dMag = Math.abs(apparentMag - p.expected.apparentMag);
          expect(
            dMag,
            `${p.name} mag: expected ${p.expected.apparentMag.toFixed(3)}, got ${apparentMag.toFixed(3)} (Δ=${dMag.toFixed(3)})`,
          ).toBeLessThanOrEqual(MAG_TOLERANCE);
        });

        // Only assert alt/az when the planet is physically above
        // the horizon in the reference.
        if (p.expected.altDegGeometric > 0) {
          it(`${p.name} alt/az within ${POS_TOLERANCE_DEG}° (above horizon)`, () => {
            const { raRad, decRad } = planetPosition(body, utcMs);
            const { altDeg, azDeg } = equatorialToHorizontal(
              raRad,
              decRad,
              latRad,
              lonRad,
              utcMs,
            );
            const expAlt = applyBennett(p.expected.altDegGeometric);
            const dAlt = Math.abs(altDeg - expAlt);
            const dAz = Math.abs(angleDiffDeg(azDeg, p.expected.azDeg));
            expect(
              dAlt,
              `${p.name} altitude: expected ${expAlt.toFixed(4)}°, got ${altDeg.toFixed(4)}° (Δ=${dAlt.toFixed(4)}°)`,
            ).toBeLessThanOrEqual(POS_TOLERANCE_DEG);
            expect(
              dAz,
              `${p.name} azimuth: expected ${p.expected.azDeg.toFixed(4)}°, got ${azDeg.toFixed(4)}° (Δ=${dAz.toFixed(4)}°)`,
            ).toBeLessThanOrEqual(POS_TOLERANCE_DEG);
          });
        }
      }
    });
  }
});
