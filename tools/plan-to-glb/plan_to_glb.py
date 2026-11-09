#!/usr/bin/env python3
"""plan_to_glb: build a 3DHome-ready GLB from a simple rectangle layout.

An alternative to the Sweet Home 3D workflow for people who only have a 2D
floor plan (a builder's PDF, a sketch, a screenshot). Trace each room as a
rectangle in any units (plan pixels, feet or metres), list the lights, and
this script writes a GLB that the 3DHome card can load directly:

  room_<NN>_<name>   floor slab + low walls; tapping it toggles `entity` if set
  light_<name>       glow zone or fixture bound to a Home Assistant entity
                     through glTF extras (`haEntity`), so no card mapping needed
  ground_<name>      outdoor slab (patio, driveway, lawn), no walls

Multiple floors are laid out side by side so a top-down view shows them all.
The script also prints a `views:` entry that frames the whole model.

Standard library only. Usage:

    python3 plan_to_glb.py layout.json home.glb
"""
import argparse
import json
import struct
import sys

UNIT_TO_M = {"m": 1.0, "ft": 0.3048, "in": 0.0254, "cm": 0.01}

MATERIALS = {
    "floor":   [0.86, 0.85, 0.82, 1],
    "wall":    [0.25, 0.26, 0.28, 1],
    "grass":   [0.55, 0.62, 0.50, 1],
    "paving":  [0.62, 0.60, 0.57, 1],
    "zone":    [0.80, 0.80, 0.78, 1],
    "fixture": [0.35, 0.35, 0.37, 1],
}


def slug(text):
    return "".join(c if c.isalnum() else "_" for c in str(text).strip()).strip("_")


class GlbBuilder:
    def __init__(self, materials):
        self.buf = bytearray()
        self.accessors, self.views, self.meshes, self.nodes = [], [], [], []
        self.material_names = []
        self.materials = []
        for name, color in materials.items():
            self.material_names.append(name)
            self.materials.append({
                "name": name,
                "pbrMetallicRoughness": {"baseColorFactor": color, "metallicFactor": 0, "roughnessFactor": 0.9},
            })

    def _view(self, data, target):
        while len(self.buf) % 4:
            self.buf.append(0)
        offset = len(self.buf)
        self.buf.extend(data)
        self.views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data), "target": target})
        return len(self.views) - 1

    def box(self, name, x0, y0, z0, x1, y1, z1, material):
        """Axis-aligned box in metres. x = right, y = up, z = down the plan."""
        faces = [
            ((1, 0, 0), [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)]),
            ((-1, 0, 0), [(x0, y0, z1), (x0, y1, z1), (x0, y1, z0), (x0, y0, z0)]),
            ((0, 1, 0), [(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)]),
            ((0, -1, 0), [(x0, y0, z1), (x0, y0, z0), (x1, y0, z0), (x1, y0, z1)]),
            ((0, 0, 1), [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]),
            ((0, 0, -1), [(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)]),
        ]
        positions, normals, indices = [], [], []
        for normal, quad in faces:
            base = len(positions)
            positions += quad
            normals += [normal] * 4
            indices += [base, base + 1, base + 2, base, base + 2, base + 3]
        pv = self._view(b"".join(struct.pack("<3f", *p) for p in positions), 34962)
        nv = self._view(b"".join(struct.pack("<3f", *n) for n in normals), 34962)
        iv = self._view(b"".join(struct.pack("<H", i) for i in indices), 34963)
        self.accessors += [
            {"bufferView": pv, "componentType": 5126, "count": len(positions), "type": "VEC3",
             "min": [min(p[i] for p in positions) for i in range(3)],
             "max": [max(p[i] for p in positions) for i in range(3)]},
            {"bufferView": nv, "componentType": 5126, "count": len(normals), "type": "VEC3"},
            {"bufferView": iv, "componentType": 5123, "count": len(indices), "type": "SCALAR"},
        ]
        a = len(self.accessors)
        self.meshes.append({"name": name, "primitives": [{
            "attributes": {"POSITION": a - 3, "NORMAL": a - 2}, "indices": a - 1,
            "material": self.material_names.index(material)}]})
        return len(self.meshes) - 1

    def node(self, name, mesh=None, extras=None, children=None):
        node = {"name": name}
        if mesh is not None:
            node["mesh"] = mesh
        if extras:
            node["extras"] = extras
        if children:
            node["children"] = children
        self.nodes.append(node)
        return len(self.nodes) - 1

    def write(self, path, root_children, root_name):
        root = self.node(root_name, children=root_children)
        while len(self.buf) % 4:
            self.buf.append(0)
        gltf = {
            "asset": {"version": "2.0", "generator": "3DHome plan_to_glb.py"},
            "scene": 0, "scenes": [{"nodes": [root]}], "nodes": self.nodes, "meshes": self.meshes,
            "materials": self.materials, "accessors": self.accessors, "bufferViews": self.views,
            "buffers": [{"byteLength": len(self.buf)}],
        }
        js = json.dumps(gltf, separators=(",", ":")).encode()
        js += b" " * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.buf)
        with open(path, "wb") as fh:
            fh.write(struct.pack("<III", 0x46546C67, 2, total))
            fh.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
            fh.write(struct.pack("<II", len(self.buf), 0x004E4942) + bytes(self.buf))
        return total


def rect_bounds(rect):
    x0, y0, x1, y1 = rect
    return min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)


def build(layout, out_path):
    unit = layout.get("units", "m")
    if unit == "px":
        scale = 0.3048 / float(layout["px_per_foot"])
    elif unit in UNIT_TO_M:
        scale = UNIT_TO_M[unit]
    else:
        raise SystemExit(f"unknown units {unit!r}; use one of px, {', '.join(UNIT_TO_M)}")

    wall_h = float(layout.get("wall_height_m", 0.9))
    wall_t = float(layout.get("wall_thickness_m", 0.12))
    gap = float(layout.get("floor_gap_m", 3.0))
    floors = layout.get("floors") or []
    if not floors:
        raise SystemExit("layout has no floors")

    b = GlbBuilder(MATERIALS)
    children = []
    room_no = 0
    cursor_x = 0.0
    min_x = min_z = float("inf")
    max_x = max_z = float("-inf")

    for floor in floors:
        shapes = [s["rect"] for key in ("rooms", "ground", "lights") for s in floor.get(key, [])]
        if not shapes:
            continue
        fx0 = min(rect_bounds(r)[0] for r in shapes)
        fx1 = max(rect_bounds(r)[2] for r in shapes)
        if "offset" in floor:
            dx, dz = (float(v) * scale for v in floor["offset"])
        else:
            dx, dz = cursor_x - fx0 * scale, 0.0
        cursor_x = dx + fx1 * scale + gap

        def to_m(rect):
            x0, y0, x1, y1 = rect_bounds(rect)
            return x0 * scale + dx, y0 * scale + dz, x1 * scale + dx, y1 * scale + dz

        for room in floor.get("rooms", []):
            room_no += 1
            ax, az, bx, bz = to_m(room["rect"])
            name = slug(room["name"])
            t = wall_t / 2
            walls = []
            for i, (wx0, wz0, wx1, wz1) in enumerate([
                    (ax - t, az - t, bx + t, az + t), (ax - t, bz - t, bx + t, bz + t),
                    (ax - t, az - t, ax + t, bz + t), (bx - t, az - t, bx + t, bz + t)]):
                if room.get("walls", True):
                    walls.append(b.node(f"wall_{name}_{i}",
                                        b.box(f"wall_{name}_{i}", wx0, 0, wz0, wx1, wall_h, wz1, "wall")))
            extras = {"type": "room"}
            if room.get("entity"):
                extras["haEntity"] = room["entity"]
            children.append(b.node(f"room_R{room_no:02d}_{name}",
                                   b.box(name, ax, -0.05, az, bx, 0.0, bz, "floor"), extras, walls))

        for ground in floor.get("ground", []):
            ax, az, bx, bz = to_m(ground["rect"])
            material = ground.get("material", "paving")
            if material not in MATERIALS:
                raise SystemExit(f"ground {ground['name']!r}: material must be grass or paving")
            name = slug(ground["name"])
            children.append(b.node(f"ground_{name}", b.box(name, ax, -0.08, az, bx, -0.03, bz, material)))

        for light in floor.get("lights", []):
            ax, az, bx, bz = to_m(light["rect"])
            kind = light.get("kind", "zone")
            if kind not in ("zone", "fixture"):
                raise SystemExit(f"light {light['name']!r}: kind must be zone or fixture")
            y0, y1 = (0.005, 0.02) if kind == "zone" else (0.02, 0.35)
            name = "light_" + slug(light["name"])
            extras = {"type": "light", "haEntity": light["entity"]}
            if light.get("ceiling"):
                extras.update({"lightCategory": "ceilinglight", "ceilingLight": "true"})
            children.append(b.node(name, b.box(name, ax, y0, az, bx, y1, bz,
                                               "zone" if kind == "zone" else "fixture"), extras))

        for r in shapes:
            ax, az, bx, bz = to_m(r)
            min_x, min_z = min(min_x, ax), min(min_z, az)
            max_x, max_z = max(max_x, bx), max(max_z, bz)

    size = b.write(out_path, children, slug(layout.get("name", "home")) or "home")
    cx, cz = (min_x + max_x) / 2, (min_z + max_z) / 2
    # The card's camera frustum is 18 m tall; zoom so the whole model fits with a margin.
    zoom = round(min(1.0, 18 / (max(max_z - min_z, (max_x - min_x) / 2.5) * 1.1)), 2)
    return size, len(b.nodes), {
        "name": "Whole house",
        "position": [round(cx, 2), 40, round(cz, 2)],
        "target": [round(cx, 2), 0, round(cz, 2)],
        "zoom": zoom,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("layout", help="layout JSON file")
    parser.add_argument("output", help="GLB file to write, e.g. home.glb")
    args = parser.parse_args(argv)
    with open(args.layout, encoding="utf-8") as fh:
        layout = json.load(fh)
    size, nodes, view = build(layout, args.output)
    print(f"wrote {args.output}: {size} bytes, {nodes} nodes")
    print("Suggested card view (add under `views:` and point `view_entity` at a number set to 1):")
    print(json.dumps(view))


if __name__ == "__main__":
    sys.exit(main())
