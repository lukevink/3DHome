# 3DHome

`3DHome` is the main repo for the full Sweet Home 3D to Home Assistant floorplan workflow.

This system has three parts:

- `3DHome`: the Lovelace card and the main user-facing repo
- `3DHome-integration`: the Home Assistant integration that provides `number.3d_home_view`
- `sweethome3d-glb-exporter`: the Sweet Home 3D exporter plugin that writes GLB or split glTF with naming and metadata for Home Assistant

If you want users to install this with the least friction, this is the repo they should land on first.

## Golden Path

Use this setup if you want the model to work with very little manual configuration:

1. In Sweet Home 3D, give each light the Home Assistant object id you want it to control.
   Example: `kitchen_table`
2. If multiple Sweet Home fixtures are controlled by the same Home Assistant light entity, give them the same Sweet Home name.
   Example: all ten downlights named `living_room_spots`
3. If a ceiling fixture should function but not be visible in the 3D card, either:
   set `glbLightType=ceilinglight`
   or prefix the Sweet Home name with `ceilinglight_`
4. Export the model with the GLB exporter and turn on `Optimize size and performance`
5. Install `3DHome-integration`
6. Install the `3DHome` dashboard card
7. Point the card at the exported GLB and set `hide_ceiling_light_geometry: true` if needed

If you follow that convention, lights can work without any manual per-light mapping in the card.

## Repos

- Main repo: [3DHome](/Users/LVink01/CODE/LAJV/3DHome)
- Integration repo: [3DHome-integration](/Users/LVink01/CODE/LAJV/3DHome-integration)
- Exporter repo: [sweethome3d-glb-exporter](/Users/LVink01/CODE/LAJV/sweethome3d-glb-exporter)

## What 3DHome Provides

- Top-down orthographic 3D rendering
- Saved camera views driven by `number.3d_home_view`
- Edit mode for panning, zooming, saving views, and manual mapping
- Auto-binding for lights by name:
  `light_kitchen_table` -> `light.kitchen_table`
- Optional metadata-driven auto-binding from GLB extras
- Room tap actions
- Optional hiding of ceiling-light geometry
- Tablet-first performance defaults

## Installation

### 1. Export from Sweet Home 3D

Install the plugin from the exporter repo:

[SweetHome3D-GLB-Exporter.sh3p](/Users/LVink01/CODE/LAJV/sweethome3d-glb-exporter/dist/SweetHome3D-GLB-Exporter.sh3p)

Export your home as `.glb` or split `.gltf`.

### 2. Install the Home Assistant integration

Install the sibling integration repo:

[3DHome-integration](/Users/LVink01/CODE/LAJV/3DHome-integration)

That creates the `3DHomeView` number entity.

### 3. Install the Lovelace card

This repo builds:

`dist/3dhome.js`

For local development, place it in Home Assistant `www` and add:

```yaml
resources:
  - url: /local/3dhome.js
    type: module
```

### 4. Add the card

```yaml
type: custom:threed-home-card
model_url: /local/floorplans/home.glb
view_entity: number.3d_home_view
performance:
  max_pixel_ratio: 1
  antialias: false
  hide_ceiling_light_geometry: true
  shadows: false
  smooth_camera: false
  continuous_render: false
```

## Make Sweet Home 3D “Just Work”

### Lights

Best practice:

- Name each Sweet Home light as the Home Assistant object id only
- Do not include `light.`
- Do not include `light_`

Examples:

- Sweet Home name `kitchen_table` exports to `light_kitchen_table` and auto-binds to `light.kitchen_table`
- Sweet Home name `living_room_spots` exports to `light_living_room_spots` and auto-binds to `light.living_room_spots`

For multiple fixtures controlled by one entity:

- Give all fixtures the same Sweet Home name
- The card applies one Home Assistant light state to all matching GLB nodes

For individually controlled fixtures:

- Use suffixes like `kitchen_spot_01`, `kitchen_spot_02`

### Ceiling lights

If ceiling lights should still work but not clutter the 3D view:

- Set custom property `glbLightType=ceilinglight`
- Or prefix the Sweet Home name with `ceilinglight_`, `ceilinglight.`, `ceiling_light_`, or `ceiling_light.`

The exporter writes `lightCategory=ceilinglight` and `ceilingLight=true` into the GLB extras.
If the marker came from the name, it is stripped from the exported name.

Example:

- Sweet Home name `ceilinglight_kitchen_spot_01`
- Exported GLB node `light_kitchen_spot_01`
- Card can hide that geometry with:

```yaml
performance:
  hide_ceiling_light_geometry: true
```

### Rooms

Keep room ids stable:

- `R01`
- `R02`
- `R03`

That keeps room names predictable, for example:

- `room_R01_Living_room`

If you want rooms to “just work” without manual card mapping, add custom properties on the room:

- `haEntity`
- `haTapAction`
- `haService`
- `haTargetEntity`

Recommended patterns:

- Toggle one entity on tap:
  `haEntity=light.living_room`
- Trigger multiple lights through a Home Assistant scene or script:
  `haService=scene.turn_on`
  `haTargetEntity=scene.living_room_evening`

If `haService` exists, the card runs a call-service action.
If only `haEntity` exists, the card toggles that entity.

### Use scenes or scripts for grouped room actions

If tapping a room should affect multiple lights, use a Home Assistant scene or script instead of trying to map many entities directly to the room.

This is easier to maintain and simpler for end users.

## Zero-Config Binding Order

Light binding priority:

1. Explicit card config
2. `haEntity` from GLB extras
3. Name-based fallback:
   `light_<slug>` -> `light.<slug>`

Room action priority:

1. Explicit card config
2. `haService` and `haTargetEntity` from GLB extras
3. `haEntity` from GLB extras as a toggle action

## Performance

Start tablets with:

```yaml
performance:
  max_pixel_ratio: 1
  antialias: false
  hide_ceiling_light_geometry: true
  shadows: false
  smooth_camera: false
  continuous_render: false
```

Important details:

- The card does not create real Three.js light objects per fixture
- Light state is represented with emissive materials on exported geometry
- Rendering is paused unless state, camera, or config changes

Because of that, ten ceiling spot meshes usually do not matter much for performance by themselves.
The geometry cost exists, but it is much lower than live shadowed lights or constant rerendering.

If you later add bloom, shadows, animated glow, or real-time lighting, then replacing many ceiling fixtures with one room-level effect becomes worthwhile.

## Local Development

Build the card:

```sh
cd /Users/LVink01/CODE/LAJV/3DHome
npm install
npm run typecheck
npm run build
```

Output:

`dist/3dhome.js`

Validate the integration:

```sh
cd /Users/LVink01/CODE/LAJV/3DHome-integration
python3 -m compileall custom_components/3dhomecard
```

Build the exporter:

```sh
cd /Users/LVink01/CODE/LAJV/sweethome3d-glb-exporter
./build.sh
```

## HACS

This project is intentionally split to match how users actually install it:

- `3DHome`: Lovelace dashboard card
- `3DHome-integration`: Home Assistant integration
- `sweethome3d-glb-exporter`: Sweet Home 3D exporter plugin
