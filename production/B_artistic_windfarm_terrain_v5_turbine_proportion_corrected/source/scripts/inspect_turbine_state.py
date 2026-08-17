#!/usr/bin/env python3
"""Validate V5 turbine hierarchy, reference proportions and sampled clearances."""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
SPEC = json.loads((ROOT / "source/terrain_spec.json").read_text(encoding="utf-8"))
SCENE_SCALE = float(SPEC["dimensions"]["turbine_scene_scale"])
EXPECTED_RADIUS = float(SPEC["dimensions"]["turbine_rotor_radius_m"]) * SCENE_SCALE
EXPECTED_HUB_HEIGHT = float(SPEC["dimensions"]["turbine_hub_height_m"]) * SCENE_SCALE
RATIO_RANGE = tuple(float(value) for value in SPEC["turbine_proportion_lock"]["target_range"])
MINIMUM_CLEARANCE = 0.24


def rounded(values) -> list[float]:
    return [round(float(value), 6) for value in values]


def world_vertices(obj: bpy.types.Object) -> list[Vector]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
    evaluated.to_mesh_clear()
    return points


def rotor_measurement(rotor: bpy.types.Object, mesh: bpy.types.Object, part: bpy.types.Object) -> dict:
    center = rotor.matrix_world.translation
    axis = rotor.matrix_world.to_3x3() @ Vector((0, 1, 0))
    axis.normalize()
    points = world_vertices(mesh)
    radial = []
    for point in points:
        delta = point - center
        radial.append(math.sqrt(max(delta.length_squared - delta.dot(axis) ** 2, 0.0)))
    return {
        "rotor_center_world": rounded(center),
        "rotor_axis_world": rounded(axis),
        "radial_extent_m": round(max(radial), 6),
        "minimum_clearance_to_part_base_m": round(min(point.z for point in points) - part.matrix_world.translation.z, 6),
    }


def main() -> None:
    scene_path = ROOT / "blender/B08_export_ready.blend"
    if not bpy.data.filepath or Path(bpy.data.filepath).resolve() != scene_path.resolve():
        bpy.ops.wm.open_mainfile(filepath=str(scene_path))
    turbines = []
    pass_all = True
    sample_angles = [0.0, math.radians(30), math.radians(60), math.radians(90)]
    for index in range(1, 4):
        suffix = f"{index:02d}"
        part = bpy.data.objects[f"PART__TURBINE_{suffix}"]
        body = bpy.data.objects[f"MESH__TURBINE_BODY_{suffix}"]
        rotor = bpy.data.objects[f"ROTOR__TURBINE_{suffix}"]
        rotor_mesh = bpy.data.objects[f"MESH__ROTOR_ASSEMBLY_{suffix}"]
        base_phase = float(rotor.rotation_euler.y)
        samples = []
        for offset in sample_angles:
            rotor.rotation_euler.y = base_phase + offset
            bpy.context.view_layer.update()
            sample = rotor_measurement(rotor, rotor_mesh, part)
            sample["phase_degrees"] = round(math.degrees(base_phase + offset), 3)
            samples.append(sample)
        rotor.rotation_euler.y = base_phase
        bpy.context.view_layer.update()
        hierarchy_ok = body.parent == part and rotor.parent == part and rotor_mesh.parent == rotor
        axis_ok = rotor.get("rotor_axis") == "Y"
        rpm_ok = float(rotor.get("rpm", 0.0)) > 0.0
        radius_error = max(abs(sample["radial_extent_m"] - EXPECTED_RADIUS) for sample in samples)
        measured_radius = sum(sample["radial_extent_m"] for sample in samples) / len(samples)
        measured_ratio = measured_radius / EXPECTED_HUB_HEIGHT
        ratio_ok = RATIO_RANGE[0] <= measured_ratio <= RATIO_RANGE[1]
        clearance_min = min(sample["minimum_clearance_to_part_base_m"] for sample in samples)
        materials = sorted({slot.material.name for slot in [*body.material_slots, *rotor_mesh.material_slots] if slot.material})
        turbine_pass = hierarchy_ok and axis_ok and rpm_ok and radius_error <= .025 and ratio_ok and clearance_min >= MINIMUM_CLEARANCE
        pass_all = pass_all and turbine_pass
        turbines.append({
            "id": suffix,
            "hierarchy": {
                "part": part.name,
                "body_parent": body.parent.name if body.parent else None,
                "rotor_parent": rotor.parent.name if rotor.parent else None,
                "rotor_mesh_parent": rotor_mesh.parent.name if rotor_mesh.parent else None,
                "ok": hierarchy_ok,
            },
            "motion": {
                "local_axis": rotor.get("rotor_axis"),
                "rpm": float(rotor.get("rpm", 0.0)),
                "initial_phase_degrees": round(math.degrees(base_phase), 3),
                "samples": samples,
                "axis_ok": axis_ok,
            },
            "geometry": {
                "expected_radius_m": EXPECTED_RADIUS,
                "terrain_scene_scale": SCENE_SCALE,
                "radius_max_error_m": round(radius_error, 6),
                "hub_height_m": EXPECTED_HUB_HEIGHT,
                "rotor_radius_to_hub_height_ratio": round(measured_ratio, 4),
                "ratio_target_range": list(RATIO_RANGE),
                "ratio_ok": ratio_ok,
                "clearance_min_m": round(clearance_min, 6),
                "body_vertices": len(body.data.vertices),
                "rotor_vertices": len(rotor_mesh.data.vertices),
                "airfoil_stations_per_blade": int(rotor_mesh.get("airfoil_stations_per_blade", 0)),
                "materials": materials,
            },
            "pass": turbine_pass,
        })
    report = {
        "asset": SPEC["asset"],
        "scene": str(scene_path),
        "world_up": "+Z",
        "expected_local_rotor_axis": "Y",
        "thresholds": {
            "radius_error_max_m": .025,
            "rotor_radius_to_hub_height_range": list(RATIO_RANGE),
            "minimum_tip_clearance_m": MINIMUM_CLEARANCE,
            "rpm_min": 0.01,
        },
        "turbines": turbines,
        "pass": pass_all,
    }
    output = ROOT / "reports/turbine_motion_validation.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if pass_all else 1)


if __name__ == "__main__":
    main()
