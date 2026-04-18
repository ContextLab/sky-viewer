// T030 — Tests for the Observation store (pure TS, no astronomy).
//
// Exercises:
//   - Coercion rules from contracts/observation-api.md: bearingDeg
//     wraps mod 360; fovDeg clamps to [30,180]; playback.rate clamps
//     to ±86400.
//   - resetToDefault writes exactly the FR-000 tuple.
//   - isOutsideVerifiedDateRange: in-range vs out-of-range dates.
//   - Re-derivation of utcInstant from localDate/localTime/offset.
//   - Subscribe/unsubscribe listener semantics.
//
// Uses createStore() to avoid cross-test singleton state.

import { describe, expect, it } from 'vitest';

import {
  createStore,
  isOutsideVerifiedDateRange,
} from '../../src/app/observation-store';
import { DEFAULT_OBSERVATION } from '../../src/app/types';

describe('observation-store — coercion', () => {
  it('bearingDeg = 370 wraps to 10', () => {
    const s = createStore();
    s.setObservation({ bearingDeg: 370 });
    expect(s.getObservation().bearingDeg).toBe(10);
  });

  it('bearingDeg = -10 wraps to 350', () => {
    const s = createStore();
    s.setObservation({ bearingDeg: -10 });
    expect(s.getObservation().bearingDeg).toBe(350);
  });

  it('bearingDeg = 720 wraps to 0', () => {
    const s = createStore();
    s.setObservation({ bearingDeg: 720 });
    expect(s.getObservation().bearingDeg).toBe(0);
  });

  it('fovDeg = 25 clamps to 30', () => {
    const s = createStore();
    s.setObservation({ fovDeg: 25 });
    expect(s.getObservation().fovDeg).toBe(30);
  });

  it('fovDeg = 200 clamps to 180', () => {
    const s = createStore();
    s.setObservation({ fovDeg: 200 });
    expect(s.getObservation().fovDeg).toBe(180);
  });

  it('playback.rate = 999999 clamps to 86400', () => {
    const s = createStore();
    s.setObservation({ playback: { rate: 999999, paused: false } });
    expect(s.getObservation().playback.rate).toBe(86400);
    expect(s.getObservation().playback.paused).toBe(false);
  });

  it('playback.rate = -999999 clamps to -86400', () => {
    const s = createStore();
    s.setObservation({ playback: { rate: -999999, paused: true } });
    expect(s.getObservation().playback.rate).toBe(-86400);
    expect(s.getObservation().playback.paused).toBe(true);
  });
});

describe('observation-store — resetToDefault', () => {
  it('writes the FR-000 tuple exactly (every field)', () => {
    const s = createStore();
    // Mutate everything first.
    s.setObservation({
      bearingDeg: 270,
      fovDeg: 45,
      localDate: '2020-01-01',
      localTime: '08:30',
      utcOffsetMinutes: 0,
    });
    const out = s.resetToDefault();
    expect(out.schemaVersion).toBe(DEFAULT_OBSERVATION.schemaVersion);
    expect(out.utcInstant).toBe(DEFAULT_OBSERVATION.utcInstant);
    expect(out.localDate).toBe(DEFAULT_OBSERVATION.localDate);
    expect(out.localTime).toBe(DEFAULT_OBSERVATION.localTime);
    expect(out.timeZone).toBe(DEFAULT_OBSERVATION.timeZone);
    expect(out.utcOffsetMinutes).toBe(DEFAULT_OBSERVATION.utcOffsetMinutes);
    expect(out.location.lat).toBe(DEFAULT_OBSERVATION.location.lat);
    expect(out.location.lon).toBe(DEFAULT_OBSERVATION.location.lon);
    expect(out.location.label).toBe(DEFAULT_OBSERVATION.location.label);
    expect(out.bearingDeg).toBe(DEFAULT_OBSERVATION.bearingDeg);
    expect(out.fovDeg).toBe(DEFAULT_OBSERVATION.fovDeg);
    expect(out.playback.rate).toBe(DEFAULT_OBSERVATION.playback.rate);
    expect(out.playback.paused).toBe(DEFAULT_OBSERVATION.playback.paused);
  });
});

describe('observation-store — isOutsideVerifiedDateRange', () => {
  it('default observation is inside range', () => {
    expect(isOutsideVerifiedDateRange(DEFAULT_OBSERVATION)).toBe(false);
  });

  it('1850-01-01 is outside range (before 1900)', () => {
    const obs = { ...DEFAULT_OBSERVATION, utcInstant: '1850-01-01T00:00:00.000Z' };
    expect(isOutsideVerifiedDateRange(obs)).toBe(true);
  });

  it('2200-01-01 is outside range (after 2100)', () => {
    const obs = { ...DEFAULT_OBSERVATION, utcInstant: '2200-01-01T00:00:00.000Z' };
    expect(isOutsideVerifiedDateRange(obs)).toBe(true);
  });
});

describe('observation-store — utcInstant re-derivation', () => {
  it('setting localDate/localTime/offset recomputes utcInstant', () => {
    const s = createStore();
    s.setObservation({
      localDate: '2000-06-21',
      localTime: '12:00',
      utcOffsetMinutes: 0,
    });
    expect(s.getObservation().utcInstant).toBe('2000-06-21T12:00:00.000Z');
  });

  it('setting only localTime re-derives with existing date and offset', () => {
    // Default has localDate=1969-12-13, localTime=00:00, offset=-300 → utcInstant=1969-12-13T05:00Z.
    // Change localTime to 06:00 → utcInstant should become 1969-12-13T11:00Z.
    const s = createStore();
    s.setObservation({ localTime: '06:00' });
    expect(s.getObservation().utcInstant).toBe('1969-12-13T11:00:00.000Z');
  });

  it('setting only utcOffsetMinutes re-derives the UTC instant', () => {
    // Default local = 1969-12-13 00:00. Switch offset from -300 to 0.
    const s = createStore();
    s.setObservation({ utcOffsetMinutes: 0 });
    expect(s.getObservation().utcInstant).toBe('1969-12-13T00:00:00.000Z');
  });
});

describe('observation-store — subscribe/unsubscribe', () => {
  it('listener is called on every change, not after unsubscribe', () => {
    const s = createStore();
    const calls: number[] = [];
    const unsub = s.subscribe((obs) => {
      calls.push(obs.bearingDeg);
    });
    s.setObservation({ bearingDeg: 90 });
    s.setObservation({ bearingDeg: 180 });
    s.setObservation({ bearingDeg: 270 });
    expect(calls).toEqual([90, 180, 270]);
    unsub();
    s.setObservation({ bearingDeg: 45 });
    s.setObservation({ bearingDeg: 10 });
    expect(calls).toEqual([90, 180, 270]);
  });

  it('resetToDefault notifies subscribers', () => {
    const s = createStore();
    const received: number[] = [];
    s.subscribe((obs) => received.push(obs.bearingDeg));
    s.setObservation({ bearingDeg: 99 });
    s.resetToDefault();
    expect(received).toEqual([99, DEFAULT_OBSERVATION.bearingDeg]);
  });
});
