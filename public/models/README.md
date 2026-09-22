# 3D laboratory models (GLB drop-in contract)

The current apparatus (`components/lab/3d/apparatus/*`) is **procedural
React Three Fiber geometry** — real 3D meshes with orbit/zoom/select/drag
interaction, built so the interaction layer could be verified before any
Blender modelling work.

A Blender-authored GLB replaces a procedural part **without touching
interaction code** when it honours this contract:

## File layout

```
public/models/
  burette.glb
  erlenmeyer-flask.glb
  beaker-250.glb
  balance.glb
  measuring-cylinder.glb
  reagent-bottle.glb
  glass-rod.glb
  volumetric-flask.glb
  waste-container.glb
```

## Named meshes (case-sensitive)

`Burette`
├── `GlassTube` — transparent wall (interaction: none, raycast passes)
├── `Scale` — graduation marks (interaction: none)
├── `Liquid` — replace with the `BuretteLiquid` overlay (height from
│   `volume-mapping.buretteLiquidSurfaceY`)
├── `Meniscus` — positioned at the liquid surface; highlighted in Reading Mode
├── `StopcockBody` — click target → `onToggleStopcock`
├── `StopcockHandle` — rotates 0 (closed) → 90° (open) about its local Z
├── `Tip` — stream origin, must sit at `BURETTE_TIP` (`spatial.ts`)
└── `ClampMount` — attaches to the stand (interaction: none)

`ErlenmeyerFlask`
├── `FlaskCone`, `FlaskNeck`, `FlaskRim`
└── `FlaskLiquid` — replaced by the `FlaskLiquid` overlay (height from
    `volume-mapping.flaskLiquidHeight`, colour from `flaskColourHex`)

## Loading

Use the existing pattern (client-only, Suspense, non-blocking):

```tsx
const { scene } = useGLTF("/models/burette.glb");
// find named parts with scene.getObjectByName("StopcockHandle")
```

wrapped in the `SceneErrorBoundary` in `LabBench3D`, so a missing or corrupt
GLB falls back to the procedural part instead of a blank canvas.

## Budgets (web)

- ≤ 25k triangles per apparatus, ≤ 100k for the whole bench
- No embedded HDRIs; PBR materials with roughness/metalness only
- One 1024px shadow map for the full scene (see `LabLighting`)
