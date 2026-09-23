"use client";

import * as THREE from "three";

/**
 * One glass material for every piece of glassware (§29–§30).
 *
 * WHY THIS EXISTS: the lab bench and walls are pale, and the first pass drew
 * glass as `#e2e8f0` at 30 % opacity — light grey at low alpha over a light grey
 * bench. The result was apparatus that was technically present and practically
 * invisible: a student could not tell a 250 mL beaker from the shadow under it.
 *
 * Glass has to be legible as an OBJECT while staying transparent: a slightly
 * blue-grey tint so it separates from the bench, an edge sheen from `clearcoat`
 * (three's built-in specular coat — no environment map needed, so the lab still
 * loads offline), and a higher alpha on the walls. Liquid, meniscus and
 * graduations are drawn separately and stay readable through it.
 *
 * The default alpha is deliberately a constant, so the apparatus files cannot
 * drift back to per-mesh guesses; anything needing to read differently (a
 * near-invisible draft shield, a thicker watch glass) passes `opacity`.
 */

/** Blue-grey tint: enough to part company with a white bench, still "clear". */
export const GLASS_TINT = "#b9c9d9";

/** Walls of vessels that hold liquid. */
export const GLASS_WALL_OPACITY = 0.46;

/** Bases, spouts and rods: thicker glass reads as more present. */
export const GLASS_THICK_OPACITY = 0.6;

export function GlassMaterial({
  color = GLASS_TINT,
  opacity = GLASS_WALL_OPACITY,
}: {
  color?: string;
  opacity?: number;
}) {
  return (
    <meshPhysicalMaterial
      color={color}
      transparent
      opacity={opacity}
      roughness={0.04}
      metalness={0}
      clearcoat={1}
      clearcoatRoughness={0.06}
      reflectivity={0.6}
      ior={1.5}
      side={THREE.DoubleSide}
    />
  );
}
