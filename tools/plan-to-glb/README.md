# plan_to_glb: a 3DHome model from a 2D floor plan

Not everyone wants to draw their house in Sweet Home 3D. If you have a 2D
floor plan, such as a builder's PDF, a sketch or a screenshot, this tool builds a
GLB that the 3DHome card can load straight away:

- **Rooms:** floor slabs with low walls. Tapping a room toggles its `entity`, if you set one.
- **Lights:** glowing zones or small fixtures. The light's Home Assistant color and
  brightness drive the glow.
- **Ground:** outdoor slabs with no walls, such as lawns, patios and driveways.
- **Floors:** placed side by side, so one top-down view shows the whole house.

Every light carries its `haEntity` in the GLB extras, so it binds without any
`lights:` mapping in the card. That works for `light.*` and for anything with an
on/off state, such as `switch.*`. The result is a clean block diagram rather than a
furnished model.

The tool needs Python 3 and nothing else.

## 1. Trace the plan

Write a layout JSON file. Every shape is a rectangle `[x0, y0, x1, y1]`, measured
from the top-left of the plan, in one unit for the whole file:

| `units` | Meaning |
|---|---|
| `ft`, `m`, `in`, `cm` | Real-world measurements |
| `px` | Pixels on a plan image; also set `px_per_foot` from a dimension on the plan |

Pixels are usually the quickest. Open the plan image in any editor that shows
cursor coordinates, then read off each room's corners. If a room is marked
18'0" across and spans 500 px, then `px_per_foot` is `27.8`.

```json
{
  "name": "My House",
  "units": "px",
  "px_per_foot": 27.8,
  "floors": [
    {
      "name": "Ground",
      "rooms":  [{ "name": "Kitchen", "rect": [100, 100, 420, 520] }],
      "ground": [{ "name": "Driveway", "rect": [100, 1400, 600, 1900], "material": "paving" }],
      "lights": [{ "name": "kitchen", "rect": [110, 110, 410, 510], "entity": "light.kitchen", "kind": "zone" }]
    }
  ]
}
```

### Fields

| Where | Field | Notes |
|---|---|---|
| top level | `wall_height_m`, `wall_thickness_m` | Defaults are `0.9` and `0.12`. Keep walls low so the top-down view stays readable. |
| top level | `floor_gap_m` | Space between floors placed side by side. Default `3`. |
| floor | `offset` | Optional `[x, y]` in layout units, to place a floor yourself. |
| room | `entity` | Optional. Tapping the room toggles it. |
| room | `walls` | `false` for open-plan areas with no walls. |
| ground | `material` | `grass` or `paving`. |
| light | `kind` | `zone` glows across an area, such as a whole room or the porch. `fixture` is a small raised block, such as a lamp. |
| light | `ceiling` | `true` marks it as a ceiling light, which `hide_ceiling_light_geometry` can hide. |

See [`example-layout.json`](example-layout.json) for a complete two-floor house.

## 2. Build the GLB

```sh
python3 tools/plan-to-glb/plan_to_glb.py my-layout.json home.glb
```

The script also prints a suggested camera view that frames the whole model.

## 3. Use it in the card

Copy `home.glb` to `/config/www/floorplans/`. The card has a fixed camera
frustum, so to open on the framed view, create a number helper set to `1` and
point `view_entity` at it:

```yaml
type: custom:threed-home-card
model_url: /local/floorplans/home.glb
view_entity: input_number.3d_home_view
views:
  - name: Whole house
    position: [14.8, 40, 9.4]
    target: [14.8, 0, 9.4]
    zoom: 0.7
performance:
  max_pixel_ratio: 1
  antialias: true
  shadows: false
  continuous_render: false
```

Use the `views` entry the script printed instead of the numbers above.
