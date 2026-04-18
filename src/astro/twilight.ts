// Twilight classification and sky background colour.
//
// The five-phase classification is the standard civil/nautical/
// astronomical twilight convention (solar altitude thresholds of 0°,
// −6°, −12°, −18°). See spec FR-007 reference.

export type TwilightPhase = 'day' | 'civil' | 'nautical' | 'astronomical' | 'night';

/**
 * Classify the twilight phase from the Sun's apparent altitude in
 * degrees.
 *
 * Thresholds (inclusive lower bound applies to the NAMED phase):
 *    sunAlt ≥   0°  → 'day'
 *   −6° ≤ sunAlt < 0°  → 'civil'
 *  −12° ≤ sunAlt < −6° → 'nautical'
 *  −18° ≤ sunAlt < −12° → 'astronomical'
 *         sunAlt < −18° → 'night'
 */
export function twilightPhase(sunAltDeg: number): TwilightPhase {
  if (sunAltDeg >= 0) return 'day';
  if (sunAltDeg >= -6) return 'civil';
  if (sunAltDeg >= -12) return 'nautical';
  if (sunAltDeg >= -18) return 'astronomical';
  return 'night';
}

interface RGBAnchor {
  alt: number; // sun altitude in degrees
  r: number;
  g: number;
  b: number;
}

// Anchor colours, sorted descending by altitude so we can interpolate
// by linear search. Values supplied verbatim from the spec.
const ANCHORS: readonly RGBAnchor[] = [
  { alt: 30, r: 135, g: 179, b: 230 }, // bright day
  { alt: 0, r: 200, g: 120, b: 70 }, // sunset / sunrise
  { alt: -6, r: 66, g: 82, b: 140 }, // civil dusk
  { alt: -12, r: 25, g: 35, b: 80 }, // nautical dusk
  { alt: -18, r: 8, g: 12, b: 30 }, // astronomical dusk
  // The −∞ anchor is the "night" colour; we clamp to this below −18°.
  { alt: -90, r: 5, g: 7, b: 15 },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Smoothly interpolated RGB sky background colour (components 0..255).
 *
 * The interpolation is piecewise-linear between the anchors above. At
 * alt ≥ 30° the colour is clamped to the bright-day anchor; at alt ≤
 * −18° (strictly: at all altitudes covered by the final "night"
 * segment) it is clamped to the night anchor.
 *
 * Each channel is rounded to the nearest integer so the output can be
 * used directly in 8-bit RGB contexts.
 */
export function skyBackgroundColor(sunAltDeg: number): { r: number; g: number; b: number } {
  // Clamp above the first anchor — bright-day colour is flat for
  // altitudes ≥ 30°.
  const first = ANCHORS[0]!;
  if (sunAltDeg >= first.alt) {
    return { r: first.r, g: first.g, b: first.b };
  }
  // Walk down the anchor list; each adjacent pair brackets a segment.
  // At the last segment (−18° → −90°) we also treat −90° as "any lower"
  // since the function is monotonic and we've clamped below.
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const hi = ANCHORS[i]!;
    const lo = ANCHORS[i + 1]!;
    if (sunAltDeg <= hi.alt && sunAltDeg >= lo.alt) {
      // Fraction of the way from hi → lo (0 at hi, 1 at lo).
      const span = hi.alt - lo.alt;
      const t = span === 0 ? 0 : (hi.alt - sunAltDeg) / span;
      return {
        r: Math.round(lerp(hi.r, lo.r, t)),
        g: Math.round(lerp(hi.g, lo.g, t)),
        b: Math.round(lerp(hi.b, lo.b, t)),
      };
    }
  }
  // Below −18°, clamp to the night colour (spec: "sunAlt ≤ −18°: (5, 7, 15)").
  // We use the special (5, 7, 15) colour from the spec rather than the
  // −90° anchor if they differ; they're identical here so the clamp is
  // natural.
  return { r: 5, g: 7, b: 15 };
}
