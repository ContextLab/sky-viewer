// T030 (addendum) — Tests for the FR-018 accessibility summary.
//
// - buildSummary(defaultObs) contains every field the FR-018 template
//   names (location label, date, local time, timezone, UTC offset,
//   cardinal facing, bearingDeg, fovDeg).
// - updateSummary writes the latest summary to the element after the
//   debounce, using __flushA11yForTests to advance the timer.

import { describe, expect, it } from 'vitest';

import {
  buildSummary,
  updateSummary,
  __flushA11yForTests,
} from '../../src/app/a11y-summary';
import { DEFAULT_OBSERVATION } from '../../src/app/types';

describe('a11y-summary — buildSummary (FR-018 template)', () => {
  it('default observation produces a string with all named fields', () => {
    const s = buildSummary(DEFAULT_OBSERVATION);
    // Location label.
    expect(s).toContain('Moore Hall');
    // Local date.
    expect(s).toContain('1969-12-13');
    // Local time.
    expect(s).toContain('00:00');
    // IANA timezone.
    expect(s).toContain('America/New_York');
    // UTC offset. Our formatter uses the typographic minus "−" (U+2212).
    expect(s).toContain('UTC−05:00');
    // Facing: cardinal direction N plus numeric bearing 0°.
    expect(s).toContain('facing N (0°)');
    // Field of view.
    expect(s).toContain('field of view 90°');
  });

  it('east-positive offset shows +HH:MM', () => {
    const s = buildSummary({
      ...DEFAULT_OBSERVATION,
      utcOffsetMinutes: 330, // India = UTC+05:30
    });
    expect(s).toContain('UTC+05:30');
  });

  it('bearing 270 produces facing W', () => {
    const s = buildSummary({ ...DEFAULT_OBSERVATION, bearingDeg: 270 });
    expect(s).toContain('facing W (270°)');
  });

  it('falls back to lat/lon when label is null', () => {
    const s = buildSummary({
      ...DEFAULT_OBSERVATION,
      location: { lat: -33.9, lon: 151.2, label: null },
    });
    expect(s).toContain('33.900°S');
    expect(s).toContain('151.200°E');
  });
});

describe('a11y-summary — updateSummary (debounced DOM write)', () => {
  it('writes to the element after __flushA11yForTests', () => {
    const el = document.createElement('div');
    // Before flush the element is untouched.
    updateSummary(DEFAULT_OBSERVATION, el);
    expect(el.textContent).toBe('');
    __flushA11yForTests();
    expect(el.textContent).toBe(buildSummary(DEFAULT_OBSERVATION));
  });

  it('coalesces rapid updates into a single commit', () => {
    const el = document.createElement('div');
    // Three rapid writes; only the last should materialise in the DOM.
    // Bearings chosen so the resulting cardinal is unambiguous:
    // 0° → N, 45° → NE, 90° → E.
    updateSummary({ ...DEFAULT_OBSERVATION, bearingDeg: 0 }, el);
    updateSummary({ ...DEFAULT_OBSERVATION, bearingDeg: 45 }, el);
    updateSummary({ ...DEFAULT_OBSERVATION, bearingDeg: 90 }, el);
    __flushA11yForTests();
    expect(el.textContent).toContain('facing E (90°)');
  });
});
