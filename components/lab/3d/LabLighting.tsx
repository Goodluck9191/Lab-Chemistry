"use client";

/**
 * Laboratory lighting: neutral, shadowed, cheap.
 *
 * One shadow-casting directional key light (1024px map), a soft ambient fill
 * and a hemisphere wash so glass and liquid read as translucent rather than
 * black. Nothing here is fetched from a network — no HDRIs, no preset
 * environments — so the laboratory loads offline and stays fast.
 */
export function LabLighting() {
  return (
    <group>
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#f8fafc", "#cbd5e1", 0.5]} />
      <directionalLight
        position={[4, 7, 4]}
        intensity={1.6}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-5, 4, -3]} intensity={0.35} />
    </group>
  );
}
