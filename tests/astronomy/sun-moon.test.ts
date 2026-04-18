// T028 — Verify sunPosition / moonPosition against astronomy-engine.
//
// For each fixture:
//   - sunPosition(utcMs) → {raRad, decRad}, projected through
//     equatorialToHorizontal, compared to fixture.sun.expected.
//     Tolerance: 0.1° (SC-006).
//   - moonPosition(utcMs) → {raRad, decRad, phase, angularDiameterArcsec},
//     projected similarly. Tolerance: 0.1° alt/az, 0.02 phase, 5
//     arcsec angular diameter.
//
// Refraction note: as in transforms.test.ts, we apply Bennett
// refraction (matching src/astro/transforms.ts) to the fixture's
// GEOMETRIC altitude to derive the expected apparent altitude.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { equatorialToHorizontal } from '../../src/astro/transforms';
import { sunPosition, moonPosition } from '../../src/astro/sun-moon';

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

interface FixtureOutput {
  name: string;
  observation: {
    utcInstant: string;
    location: { lat: number; lon: number };
  };
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

const POS_TOLERANCE_DEG = 0.1;
const PHASE_TOLERANCE = 0.02;
const ANG_DIAM_TOLERANCE_ARCSEC = 5;

describe('sunPosition — 5 fixtures', () => {
  for (const fname of FIXTURE_NAMES) {
    const fixture = loadFixture(fname);
    const utcMs = Date.parse(fixture.observation.utcInstant);
    const latRad = fixture.observation.location.lat * DEG2RAD;
    const lonRad = fixture.observation.location.lon * DEG2RAD;

    it(`${fname} sun alt/az within ${POS_TOLERANCE_DEG}°`, () => {
      const { raRad, decRad } = sunPosition(utcMs);
      const { altDeg, azDeg } = equatorialToHorizontal(
        raRad,
        decRad,
        latRad,
        lonRad,
        utcMs,
      );
      const expAlt = applyBennett(fixture.sun.expected.altDegGeometric);
      const dAlt = Math.abs(altDeg - expAlt);
      const dAz = Math.abs(angleDiffDeg(azDeg, fixture.sun.expected.azDeg));
      expect(
        dAlt,
        `sun altitude: expected ${expAlt.toFixed(4)}°, got ${altDeg.toFixed(4)}° (Δ=${dAlt.toFixed(4)}°)`,
      ).toBeLessThanOrEqual(POS_TOLERANCE_DEG);
      expect(
        dAz,
        `sun azimuth: expected ${fixture.sun.expected.azDeg.toFixed(4)}°, got ${azDeg.toFixed(4)}° (Δ=${dAz.toFixed(4)}°)`,
      ).toBeLessThanOrEqual(POS_TOLERANCE_DEG);
    });
  }
});

describe('moonPosition — 5 fixtures', () => {
  for (const fname of FIXTURE_NAMES) {
    const fixture = loadFixture(fname);
    const utcMs = Date.parse(fixture.observation.utcInstant);
    const latRad = fixture.observation.location.lat * DEG2RAD;
    const lonRad = fixture.observation.location.lon * DEG2RAD;

    it(`${fname} moon alt/az within ${POS_TOLERANCE_DEG}°`, () => {
      const { raRad, decRad } = moonPosition(utcMs);
      const { altDeg, azDeg } = equatorialToHorizontal(
        raRad,
        decRad,
        latRad,
        lonRad,
        utcMs,
      );
      const expAlt = applyBennett(fixture.moon.expected.altDegGeometric);
      const dAlt = Math.abs(altDeg - expAlt);
      const dAz = Math.abs(angleDiffDeg(azDeg, fixture.moon.expected.azDeg));
      expect(
        dAlt,
        `moon altitude: expected ${expAlt.toFixed(4)}°, got ${altDeg.toFixed(4)}° (Δ=${dAlt.toFixed(4)}°)`,
      ).toBeLessThanOrEqual(POS_TOLERANCE_DEG);
      expect(
        dAz,
        `moon azimuth: expected ${fixture.moon.expected.azDeg.toFixed(4)}°, got ${azDeg.toFixed(4)}° (Δ=${dAz.toFixed(4)}°)`,
      ).toBeLessThanOrEqual(POS_TOLERANCE_DEG);
    });

    it(`${fname} moon phase within ${PHASE_TOLERANCE}`, () => {
      const { phase } = moonPosition(utcMs);
      const dPhase = Math.abs(phase - fixture.moon.expected.phase);
      expect(
        dPhase,
        `moon phase: expected ${fixture.moon.expected.phase.toFixed(4)}, got ${phase.toFixed(4)} (Δ=${dPhase.toFixed(4)})`,
      ).toBeLessThanOrEqual(PHASE_TOLERANCE);
    });

    it(`${fname} moon angular diameter within ${ANG_DIAM_TOLERANCE_ARCSEC}"`, () => {
      const { angularDiameterArcsec } = moonPosition(utcMs);
      const dAng = Math.abs(
        angularDiameterArcsec - fixture.moon.expected.angularDiameterArcsec,
      );
      expect(
        dAng,
        `moon ang-diam: expected ${fixture.moon.expected.angularDiameterArcsec.toFixed(2)}", got ${angularDiameterArcsec.toFixed(2)}" (Δ=${dAng.toFixed(2)}")`,
      ).toBeLessThanOrEqual(ANG_DIAM_TOLERANCE_ARCSEC);
    });
  }
});
