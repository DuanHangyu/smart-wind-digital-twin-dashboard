#!/usr/bin/env python3
"""Export structured turbine hierarchy, axes and bounds from the current B08."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]


def rounded(values) -> list[float]:
    return [round(float(value), 6) for value in values]


def bounds_world(obj: bpy.types.Object) -> dict | None:
    if obj.type != "MESH":
        return None
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return {
        "min": rounded([min(point[index] for point in corners) for index in range(3)]),
        "max": rounded([max(point[index] for point in corners) for index in range(3)]),
    }


def main() -> None:
    scene_path = ROOT / "blender/B08_export_ready.blend"
    if not bpy.data.filepath or Path(bpy.data.filepath).resolve() != scene_path.resolve():
        bpy.ops.wm.open_mainfile(filepath=str(scene_path))
    objects = []
    for obj in sorted(bpy.data.objects, key=lambda item: item.name):
        if not any(token in obj.name for token in ("TURBINE", "TOWER", "NACELLE", "HUB", "BLADE", "ROTOR")):
            continue
        objects.append({
            "name": obj.name,
            "type": obj.type,
            "parent": obj.parent.name if obj.parent else None,
            "location_local": rounded(obj.location),
            "rotation_euler_local": rounded(obj.rotation_euler),
            "scale_local": rounded(obj.scale),
            "bounds_world": bounds_world(obj),
            "vertices": len(obj.data.vertices) if obj.type == "MESH" else 0,
            "triangles": len(obj.data.loop_triangles) if obj.type == "MESH" else 0,
            "extras": {key: obj[key] for key in obj.keys()},
        })
    report = {
        "scene": str(scene_path),
        "world_up": "+Z",
        "rotor_axis_expected": "+/-Y",
        "object_count": len(objects),
        "objects": objects,
    }
    output = ROOT / "reports/turbine_state_before_v3.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
