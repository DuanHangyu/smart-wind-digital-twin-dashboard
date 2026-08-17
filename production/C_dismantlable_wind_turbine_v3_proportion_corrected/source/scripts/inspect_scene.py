#!/usr/bin/env python3
"""Blender-side mechanical alignment, UV and hierarchy audit."""
from __future__ import annotations
import json, math
from pathlib import Path
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
SPEC=json.loads((ROOT/"source/turbine_spec.json").read_text(encoding="utf-8"))
HUB=Vector(SPEC["dimensions"]["hub_center"])
TARGET_ROTOR=float(SPEC["dimensions"]["rotor_radius"])

def center(obj): return sum((obj.matrix_world@v.co for v in obj.data.vertices),Vector())/max(1,len(obj.data.vertices))
def main():
    parts=[o for o in bpy.data.objects if o.name.startswith("PART__")]
    hotspots=[o for o in bpy.data.objects if o.name.startswith("HOTSPOT__")]
    rotors=[o for o in bpy.data.objects if o.name.startswith("ROTOR__")]
    by={o.name:o for o in parts}
    triangles=sum(len(o.data.loop_triangles) if (o.data.calc_loop_triangles() or True) else 0 for o in parts if o.type=="MESH")
    # The designated rotational datum is the object origin; housings/pedestals are intentionally asymmetric below it.
    axes={name:by[name].matrix_world.translation.copy() for name in ("PART__MAIN_SHAFT","PART__MAIN_BEARING","PART__GEARBOX","PART__GENERATOR")}
    axis_deviation=max(abs(v.x) for v in axes.values())
    axis_z_deviation=max(abs(v.z-6.56) for v in axes.values())
    radii=[]
    for name in ("PART__BLADE_A","PART__BLADE_B","PART__BLADE_C"):
        radii.append(max(((by[name].matrix_world@v.co)-HUB).length for v in by[name].data.vertices))
    uv_min,uv_max=1.0,0.0
    for o in parts:
        for layer in o.data.uv_layers:
            for loop in layer.data: uv_min=min(uv_min,loop.uv.x,loop.uv.y);uv_max=max(uv_max,loop.uv.x,loop.uv.y)
    checks={
        "part_count":len(parts)==15,"hotspot_count":len(hotspots)==9,"rotor_count":len(rotors)==1,
        "rotor_parenting":all(by[n].parent==rotors[0] for n in ("PART__SPINNER","PART__HUB","PART__BLADE_A","PART__BLADE_B","PART__BLADE_C","PART__MAIN_SHAFT")),
        "drivetrain_axis_x_deviation_le_5cm":axis_deviation<=.05,"drivetrain_axis_z_deviation_le_8cm":axis_z_deviation<=.08,
        "blade_radius_spread_le_1cm":max(radii)-min(radii)<=.01,
        "blade_radius_reference_target_4_45m":all(abs(radius-TARGET_ROTOR) <= .03 for radius in radii),
        "rotor_radius_to_hub_height_reference_ratio":.66 <= (sum(radii)/len(radii))/HUB.z <= .70,
        "uv_in_unit_square":uv_min>=-1e-5 and uv_max<=1.00001,
        "metadata_complete":all(len(o.get("explode_vector",[]))==3 and o.get("interactive") for o in parts),"triangles_under_budget":triangles<=45000,
        "hotspots_target_valid":all(o.get("target") in by for o in hotspots),
    }
    report={"blender_version":bpy.app.version_string,"parts":len(parts),"hotspots":len(hotspots),"rotors":len(rotors),"triangles":triangles,
            "drivetrain_centers":{k:[round(c,4) for c in v] for k,v in axes.items()},"axis_x_deviation_m":round(axis_deviation,5),
            "axis_z_deviation_m":round(axis_z_deviation,5),"blade_radii_m":[round(x,4) for x in radii],
            "rotor_radius_to_hub_height_ratio":round((sum(radii)/len(radii))/HUB.z,4),
            "uv_range":[round(uv_min,6),round(uv_max,6)],"checks":checks,"pass":all(checks.values())}
    (ROOT/"reports/scene_validation.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False,indent=2))
    if not report["pass"]: raise SystemExit(1)
if __name__=="__main__": main()
