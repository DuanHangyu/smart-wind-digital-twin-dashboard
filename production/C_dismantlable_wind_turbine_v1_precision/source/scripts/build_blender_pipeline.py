#!/usr/bin/env python3
"""Reference-driven eight-stage Blender pipeline for the dismantlable turbine.

The script is intentionally deterministic: it rebuilds every stage from the same
metric specification and saves a new .blend instead of mutating an earlier stage.
"""

from __future__ import annotations

import json
import math
import shutil
import time
from array import array
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
SPEC = json.loads((ROOT / "source" / "turbine_spec.json").read_text(encoding="utf-8"))
BLEND_DIR = ROOT / "blender"
RENDER_DIR = ROOT / "renders"
TEXTURE_DIR = ROOT / "textures" / "png"
EXPORT_DIR = ROOT / "export"
REPORT_DIR = ROOT / "reports"
for directory in (BLEND_DIR, RENDER_DIR, TEXTURE_DIR, EXPORT_DIR, REPORT_DIR):
    directory.mkdir(parents=True, exist_ok=True)

HUB = Vector(SPEC["dimensions"]["hub_center"])
ROTOR_R = float(SPEC["dimensions"]["rotor_radius"])
ATLAS_GRID = 4
ATLAS_CELLS = {
    "white_composite": (0, 0), "blue_machine": (1, 0), "red_transmission": (2, 0),
    "black_steel": (3, 0), "silver_plate": (0, 1), "dark_steel": (1, 1),
    "cyan_glass_guide": (2, 1), "rubber_seal": (3, 1),
}
ZONE_COLORS = {
    "white_composite": (0.78, 0.82, 0.83, 1), "blue_machine": (0.035, 0.15, 0.42, 1),
    "red_transmission": (0.46, 0.035, 0.025, 1), "black_steel": (0.015, 0.022, 0.027, 1),
    "silver_plate": (0.48, 0.52, 0.53, 1), "dark_steel": (0.08, 0.10, 0.12, 1),
    "rubber_seal": (0.012, 0.016, 0.019, 1), "cyan_glass_guide": (0.0, 0.42, 0.46, 1),
}


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def collection(name: str) -> bpy.types.Collection:
    result = bpy.data.collections.get(name)
    if result is None:
        result = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(result)
    return result


def move_to_collection(obj: bpy.types.Object, name: str = "COLL__ASSET") -> None:
    target = collection(name)
    if obj.name not in target.objects:
        target.objects.link(obj)
    for current in list(obj.users_collection):
        if current != target:
            current.objects.unlink(obj)


def smooth(obj: bpy.types.Object) -> bpy.types.Object:
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def image(path: Path, non_color: bool = False) -> bpy.types.Image:
    result = bpy.data.images.load(str(path), check_existing=True)
    if non_color:
        try:
            result.colorspace_settings.name = "Non-Color"
        except Exception:
            pass
    return result


def simple_material(name: str, color: tuple[float, float, float, float], roughness: float = .45,
                    metallic: float = .05, emission: float = 0.0) -> bpy.types.Material:
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    emission_color = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
    if emission_color is not None and emission > 0:
        emission_color.default_value = color
        shader.inputs["Emission Strength"].default_value = emission
    links.new(shader.outputs[0], output.inputs[0])
    return material


def zone_material(zone: str) -> bpy.types.Material:
    metallic = .72 if zone in {"black_steel", "dark_steel", "silver_plate"} else .08
    return simple_material(f"MAT__{zone.upper()}", ZONE_COLORS[zone], .34 if metallic > .5 else .42, metallic)


def glass_material() -> bpy.types.Material:
    material = simple_material("MAT__CYAN_CUTAWAY_GLASS", (0.0, .38, .43, .18), .14, .12, .35)
    shader = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    shader.inputs["Alpha"].default_value = .18
    if "Transmission Weight" in shader.inputs:
        shader.inputs["Transmission Weight"].default_value = .18
    try:
        material.surface_render_method = "DITHERED"
    except Exception:
        material.diffuse_color = (0.0, .38, .43, .18)
    return material


def wire_material() -> bpy.types.Material:
    material = bpy.data.materials.get("MAT__CYAN_WIREFRAME") or bpy.data.materials.new("MAT__CYAN_WIREFRAME")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    wire = nodes.new("ShaderNodeWireframe")
    wire.use_pixel_size = False
    wire.inputs["Size"].default_value = .006
    dark = nodes.new("ShaderNodeBsdfPrincipled")
    dark.inputs["Base Color"].default_value = (.001, .008, .012, 1)
    dark.inputs["Roughness"].default_value = .88
    glow = nodes.new("ShaderNodeEmission")
    glow.inputs["Color"].default_value = (0.0, .72, .78, 1)
    glow.inputs["Strength"].default_value = 2.1
    mix = nodes.new("ShaderNodeMixShader")
    links.new(wire.outputs["Fac"], mix.inputs[0])
    links.new(dark.outputs[0], mix.inputs[1])
    links.new(glow.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], output.inputs[0])
    return material


def uv_checker_material() -> bpy.types.Material:
    material = bpy.data.materials.get("MAT__UV_CHECKER") or bpy.data.materials.new("MAT__UV_CHECKER")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image(TEXTURE_DIR / "C_Turbine_UV_Checker.png")
    links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    shader.inputs["Roughness"].default_value = .68
    links.new(shader.outputs[0], output.inputs[0])
    return material


def gltf_occlusion_group() -> bpy.types.NodeTree:
    group = bpy.data.node_groups.get("glTF Material Output")
    if group is not None:
        return group
    group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    group.nodes.new("NodeGroupOutput")
    return group


def pbr_material() -> bpy.types.Material:
    material = bpy.data.materials.get("MAT__C_TURBINE_PBR") or bpy.data.materials.new("MAT__C_TURBINE_PBR")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    base = nodes.new("ShaderNodeTexImage")
    base.name = "TEX__C_BASE_COLOR"
    base.image = image(TEXTURE_DIR / "C_Turbine_BaseColor.png")
    links.new(base.outputs["Color"], shader.inputs["Base Color"])
    orm = nodes.new("ShaderNodeTexImage")
    orm.name = "TEX__C_ORM"
    orm.image = image(TEXTURE_DIR / "C_Turbine_ORM.png", True)
    separate = nodes.new("ShaderNodeSeparateColor")
    links.new(orm.outputs["Color"], separate.inputs["Color"])
    links.new(separate.outputs["Green"], shader.inputs["Roughness"])
    links.new(separate.outputs["Blue"], shader.inputs["Metallic"])
    normal_tex = nodes.new("ShaderNodeTexImage")
    normal_tex.name = "TEX__C_NORMAL"
    normal_tex.image = image(TEXTURE_DIR / "C_Turbine_Normal.png", True)
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = .24
    links.new(normal_tex.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], shader.inputs["Normal"])
    occlusion = nodes.new("ShaderNodeGroup")
    occlusion.name = "glTF Material Output"
    occlusion.node_tree = gltf_occlusion_group()
    links.new(separate.outputs["Red"], occlusion.inputs["Occlusion"])
    links.new(shader.outputs[0], output.inputs[0])
    return material


def piece(obj: bpy.types.Object, zone: str) -> bpy.types.Object:
    obj["asset_zone"] = zone
    move_to_collection(obj)
    return obj


def add_cube(name: str, dimensions, location, zone: str, bevel: float = .0, segments: int = 2) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new(f"BEVEL__{name}", "BEVEL")
        mod.width, mod.segments, mod.limit_method = bevel, segments, "ANGLE"
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return piece(obj, zone)


def orient_z_to(obj: bpy.types.Object, direction: Vector) -> None:
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())


def add_cylinder(name: str, radius: float, depth: float, location, zone: str, vertices: int = 24,
                 direction: Vector = Vector((0, 0, 1)), bevel: float = 0.0) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    orient_z_to(obj, direction)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new(f"BEVEL__{name}", "BEVEL")
        mod.width, mod.segments = bevel, 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return piece(smooth(obj), zone)


def add_cone(name: str, radius1: float, radius2: float, depth: float, location, zone: str,
             vertices: int = 32) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    return piece(smooth(obj), zone)


def add_sphere(name: str, radius: float, location, zone: str, scale=(1, 1, 1), segments=32, rings=16) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return piece(smooth(obj), zone)


def add_torus(name: str, major: float, minor: float, location, zone: str, major_segments=32, minor_segments=8,
              direction: Vector = Vector((0, 0, 1))) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=major_segments,
                                    minor_segments=minor_segments, location=location)
    obj = bpy.context.object
    obj.name = name
    orient_z_to(obj, direction)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return piece(smooth(obj), zone)


def create_blade(name: str, angle_degrees: float, quality: int) -> bpy.types.Object:
    stations = [
        (.37, .24, .20, 23.0, .000, .000), (.54, .38, .17, 19.0, .010, -.010),
        (.82, .44, .145, 14.0, .035, -.020), (1.15, .37, .115, 9.0, .065, -.032),
        (1.55, .29, .085, 5.0, .092, -.048), (1.92, .20, .055, 2.0, .105, -.062),
        (2.20, .12, .034, .8, .100, -.074), (ROTOR_R, .055, .018, 0.0, .085, -.082),
    ]
    sections = 10 if quality >= 1 else 6
    vertices = []
    for radial, chord, thick, twist_degrees, sweep, prebend in stations:
        twist = math.radians(twist_degrees)
        for k in range(sections):
            theta = 2 * math.pi * k / sections
            # Airfoil-like ellipse: broad leading edge and thinner trailing half.
            x = math.cos(theta) * chord * .5
            y = math.sin(theta) * thick * (.50 + .12 * math.cos(theta))
            camber = .04 * chord * (1 - (2 * x / max(chord, .001)) ** 2)
            xx = sweep + x * math.cos(twist) - (y + camber) * math.sin(twist)
            yy = -0.72 + prebend + x * math.sin(twist) + (y + camber) * math.cos(twist)
            local = Vector((xx, yy, 6.55 + radial))
            rel = local - HUB
            rel.rotate(Matrix.Rotation(math.radians(angle_degrees), 4, 'Y'))
            vertices.append(tuple(HUB + rel))
    faces = []
    for i in range(len(stations) - 1):
        for k in range(sections):
            a = i * sections + k
            b = i * sections + (k + 1) % sections
            c = (i + 1) * sections + (k + 1) % sections
            d = (i + 1) * sections + k
            faces.append((a, b, c, d))
    faces += [tuple(reversed(range(sections))), tuple((len(stations) - 1) * sections + k for k in range(sections))]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vi = mesh.loops[loop_index].vertex_index
            uv.data[loop_index].uv = ((vi % sections) / sections, (vi // sections) / (len(stations) - 1))
    obj = bpy.data.objects.new(name, mesh)
    collection("COLL__ASSET").objects.link(obj)
    obj["asset_zone"] = "white_composite"
    obj["airfoil_stations"] = len(stations)
    obj["twist_root_degrees"] = 23.0
    obj["blade_angle_degrees"] = angle_degrees
    return smooth(obj)


def create_capsule_shell(name: str, quality: int) -> bpy.types.Object:
    segments = 40 if quality >= 2 else (28 if quality >= 1 else 18)
    rings = [
        (-.34, .42, .46), (-.26, .64, .58), (-.08, .73, .63),
        (.45, .73, .63), (1.28, .73, .63), (1.93, .70, .60),
        (2.18, .57, .51), (2.27, .30, .30), (2.29, .05, .05),
    ]
    vertices = []
    for y, rx, rz in rings:
        for k in range(segments):
            theta = 2 * math.pi * k / segments
            vertices.append((math.cos(theta) * rx, y, 6.60 + math.sin(theta) * rz))
    faces = []
    for r in range(len(rings) - 1):
        for k in range(segments):
            faces.append((r * segments + k, r * segments + (k + 1) % segments,
                          (r + 1) * segments + (k + 1) % segments, (r + 1) * segments + k))
    faces += [tuple(reversed(range(segments))), tuple((len(rings) - 1) * segments + k for k in range(segments))]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vi = mesh.loops[loop_index].vertex_index
            uv.data[loop_index].uv = ((vi % segments) / segments, (vi // segments) / (len(rings) - 1))
    obj = bpy.data.objects.new(name, mesh)
    collection("COLL__ASSET").objects.link(obj)
    obj["asset_zone"] = "white_composite"
    return smooth(obj)


def map_uv_to_zone(obj: bpy.types.Object, zone: str) -> None:
    if obj.type != "MESH":
        return
    if not obj.data.uv_layers:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=.02)
        bpy.ops.object.mode_set(mode="OBJECT")
    cx, cy_top = ATLAS_CELLS.get(zone, (0, 0))
    cy = ATLAS_GRID - 1 - cy_top
    inset = .035
    for layer in obj.data.uv_layers:
        for loop in layer.data:
            u = max(0.0, min(1.0, loop.uv.x % 1.0))
            v = max(0.0, min(1.0, loop.uv.y % 1.0))
            loop.uv.x = (cx + inset + u * (1 - inset * 2)) / ATLAS_GRID
            loop.uv.y = (cy + inset + v * (1 - inset * 2)) / ATLAS_GRID


def prepare_piece_material(obj: bpy.types.Object, mode: str) -> None:
    zone = str(obj.get("asset_zone", "white_composite"))
    obj.data.materials.clear()
    if mode == "pbr":
        map_uv_to_zone(obj, zone)
        obj.data.materials.append(pbr_material())
    elif mode == "wire":
        obj.data.materials.append(wire_material())
    elif mode == "uv":
        obj.data.materials.append(uv_checker_material())
    elif mode == "clay":
        obj.data.materials.append(simple_material("MAT__BASE_CLAY", (.28, .36, .37, 1), .58, .03))
    else:
        obj.data.materials.append(zone_material(zone))


def join_part(objects: list[bpy.types.Object], name: str, mode: str, prefix: str = "") -> bpy.types.Object:
    if not objects:
        raise ValueError(name)
    for obj in objects:
        prepare_piece_material(obj, mode)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    active = objects[0]
    bpy.context.view_layer.objects.active = active
    bpy.ops.object.join()
    active.name = f"{prefix}{name}"
    active["canonical_name"] = name
    active["interactive"] = not prefix
    return active


def parent_keep_world(obj: bpy.types.Object, parent: bpy.types.Object) -> None:
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world


def part_spec(name: str) -> dict:
    return next(item for item in SPEC["parts"] if item["name"] == name)


def tag_part(obj: bpy.types.Object, canonical: str, quality: int) -> None:
    info = part_spec(canonical)
    obj["display_name"] = info["display_name"]
    obj["part_type"] = info["type"]
    obj["interactive"] = True
    obj["explode_vector"] = info["explode_vector"]
    obj["assembly_order"] = info["assembly_order"]
    obj["material_zone"] = info["material_zone"]
    obj["detail_level"] = ["base", "web_low", "highpoly"][min(quality, 2)]


def build_tower(q: int):
    seg = 48 if q >= 2 else (32 if q >= 1 else 20)
    return [
        add_cone("tower_shell", .70, .43, 5.52, (0, 0, 2.76), "white_composite", seg),
        add_cylinder("tower_base_flange", .78, .15, (0, 0, .075), "white_composite", seg, bevel=.025),
        add_cylinder("tower_top_flange", .51, .18, (0, 0, 5.60), "white_composite", seg, bevel=.018),
        add_cube("tower_service_door", (.38, .035, .78), (0, -.585, 1.12), "dark_steel", .04, 3),
    ]


def build_yaw_base(q: int):
    seg = 40 if q >= 2 else 28
    objects = [
        add_cylinder("yaw_adapter", .55, .40, (0, .18, 5.79), "white_composite", seg, bevel=.015),
        add_cylinder("yaw_adapter_top", .67, .12, (0, .18, 5.98), "silver_plate", seg, bevel=.014),
        add_cylinder("yaw_adapter_bottom", .61, .11, (0, .18, 5.59), "white_composite", seg),
    ]
    for i in range(12):
        angle = 2 * math.pi * i / 12
        rib = add_cube(f"yaw_rib_{i}", (.055, .16, .28), (.47 * math.cos(angle), .18 + .47 * math.sin(angle), 5.78),
                       "white_composite", .012, 1)
        rib.rotation_euler.z = angle
        objects.append(rib)
    return objects


def build_yaw_gear(q: int):
    teeth = 72 if q >= 2 else 52
    objects = [add_torus("yaw_ring", .54, .075, (0, .18, 6.08), "black_steel", teeth, 8)]
    for i in range(teeth):
        angle = 2 * math.pi * i / teeth
        tooth = add_cube(f"yaw_tooth_{i}", (.045, .105, .10), (.61 * math.cos(angle), .18 + .61 * math.sin(angle), 6.08),
                         "black_steel", .006, 1)
        tooth.rotation_euler.z = angle
        objects.append(tooth)
    return objects


def build_bedplate(q: int):
    objects = [
        add_cube("rail_left", (.34, 2.22, .15), (-.48, .92, 6.12), "silver_plate", .055, 3),
        add_cube("rail_right", (.34, 2.22, .15), (.48, .92, 6.12), "silver_plate", .055, 3),
        add_cube("cross_front", (1.30, .30, .15), (0, -.02, 6.12), "silver_plate", .05, 3),
        add_cube("cross_rear", (1.30, .32, .15), (0, 1.88, 6.12), "silver_plate", .05, 3),
        add_cube("step_left", (.42, .62, .13), (-.48, 1.54, 6.25), "silver_plate", .04, 2),
        add_cube("step_right", (.42, .62, .13), (.48, 1.54, 6.25), "silver_plate", .04, 2),
    ]
    for x in (-.56, .56):
        for y in (.04, .72, 1.45, 1.88):
            objects.append(add_cylinder(f"bed_bolt_{x}_{y}", .055, .12, (x, y, 6.27), "black_steel", 16, bevel=.008))
    return objects


def build_hub(q: int):
    seg = 48 if q >= 2 else 32
    objects = [add_sphere("hub_core", .37, HUB, "white_composite", (1, 1.12, 1), seg, seg // 2)]
    for angle_deg in (0, 120, 240):
        angle = math.radians(angle_deg)
        direction = Vector((math.sin(angle), 0, math.cos(angle)))
        location = HUB + direction * .37
        objects += [
            add_cylinder(f"blade_socket_{angle_deg}", .20, .24, location, "white_composite", seg,
                         direction=direction, bevel=.018),
            add_torus(f"blade_seal_{angle_deg}", .18, .028, HUB + direction * .50, "rubber_seal", seg, 8,
                      direction=direction),
        ]
    return objects


def build_spinner(q: int):
    seg = 48 if q >= 2 else 32
    return [add_sphere("spinner", .38, (0, -1.02, 6.55), "white_composite", (1.0, 1.18, 1.0), seg, seg // 2),
            add_torus("spinner_seam", .34, .018, (0, -.82, 6.55), "rubber_seal", seg, 6, Vector((0, 1, 0)))]


def build_main_shaft(q: int):
    seg = 40 if q >= 2 else 28
    objects = [
        add_cylinder("main_shaft", .12, 1.50, (0, .30, 6.55), "red_transmission", seg, Vector((0, 1, 0)), .012),
        add_cylinder("shaft_flange", .34, .13, (0, -.36, 6.55), "red_transmission", seg, Vector((0, 1, 0)), .016),
        add_cylinder("shaft_collar_front", .18, .18, (0, -.22, 6.55), "blue_machine", seg, Vector((0, 1, 0))),
        add_cylinder("shaft_collar_rear", .17, .18, (0, 1.03, 6.55), "dark_steel", seg, Vector((0, 1, 0))),
    ]
    for i in range(10):
        a = 2 * math.pi * i / 10
        pos = (.245 * math.cos(a), -.435, 6.55 + .245 * math.sin(a))
        objects.append(add_cylinder(f"flange_bolt_{i}", .025, .055, pos, "black_steel", 12, Vector((0, 1, 0))))
    return objects


def build_main_bearing(q: int):
    seg = 40 if q >= 2 else 28
    return [
        add_cylinder("bearing_outer", .31, .30, (0, .22, 6.55), "blue_machine", seg, Vector((0, 1, 0)), .018),
        add_cylinder("bearing_inner", .18, .34, (0, .22, 6.55), "dark_steel", seg, Vector((0, 1, 0))),
        add_cube("bearing_pedestal", (.64, .44, .25), (0, .22, 6.29), "blue_machine", .055, 3),
        add_cube("bearing_foot_l", (.28, .52, .10), (-.25, .22, 6.23), "blue_machine", .025, 2),
        add_cube("bearing_foot_r", (.28, .52, .10), (.25, .22, 6.23), "blue_machine", .025, 2),
    ]


def build_gearbox(q: int):
    seg = 40 if q >= 2 else 28
    objects = [
        add_cylinder("gearbox_body", .38, .55, (0, .78, 6.58), "blue_machine", seg, Vector((0, 1, 0)), .025),
        add_cube("gearbox_lower", (.70, .54, .42), (0, .78, 6.39), "blue_machine", .075, 4),
        add_cube("gearbox_cap", (.55, .46, .20), (0, .78, 6.92), "blue_machine", .055, 3),
        add_cylinder("gearbox_input", .19, .20, (0, .47, 6.55), "dark_steel", seg, Vector((0, 1, 0))),
        add_cylinder("gearbox_output", .14, .18, (0, 1.10, 6.55), "dark_steel", seg, Vector((0, 1, 0))),
    ]
    for x in (-.26, .26):
        objects.append(add_cube(f"gearbox_rib_{x}", (.045, .48, .44), (x, .78, 6.57), "blue_machine", .012, 1))
    return objects


def build_generator(q: int):
    seg = 40 if q >= 2 else 28
    objects = [
        add_cylinder("generator_body", .40, .76, (0, 1.55, 6.58), "blue_machine", seg, Vector((0, 1, 0)), .032),
        add_cylinder("generator_front", .31, .13, (0, 1.12, 6.58), "blue_machine", seg, Vector((0, 1, 0))),
        add_cylinder("generator_rear", .34, .12, (0, 1.98, 6.58), "blue_machine", seg, Vector((0, 1, 0))),
        add_cube("generator_terminal", (.48, .55, .22), (0, 1.58, 7.00), "blue_machine", .05, 3),
        add_cube("generator_foot_l", (.30, .74, .12), (-.27, 1.55, 6.25), "blue_machine", .025, 2),
        add_cube("generator_foot_r", (.30, .74, .12), (.27, 1.55, 6.25), "blue_machine", .025, 2),
    ]
    for i in range(-3, 4):
        objects.append(add_torus(f"generator_fin_{i}", .405, .018, (0, 1.55 + i * .085, 6.58),
                                 "blue_machine", seg, 6, Vector((0, 1, 0))))
    return objects


def build_brake(q: int):
    return [
        add_cube("brake_box", (.30, .42, .55), (.52, 1.52, 6.55), "red_transmission", .045, 3),
        add_cube("brake_lid", (.32, .44, .06), (.52, 1.52, 6.85), "red_transmission", .025, 2),
        add_cylinder("brake_disc", .23, .07, (0, 1.08, 6.55), "red_transmission", 32, Vector((0, 1, 0))),
        add_cube("cable_box", (.18, .30, .20), (.54, 1.88, 6.37), "dark_steel", .025, 2),
    ]


BUILDERS = {
    "PART__TOWER": build_tower, "PART__YAW_BASE": build_yaw_base, "PART__YAW_GEAR": build_yaw_gear,
    "PART__BEDPLATE": build_bedplate, "PART__SPINNER": build_spinner, "PART__HUB": build_hub,
    "PART__MAIN_SHAFT": build_main_shaft, "PART__MAIN_BEARING": build_main_bearing,
    "PART__GEARBOX": build_gearbox, "PART__GENERATOR": build_generator, "PART__BRAKE_UNIT": build_brake,
}


def create_empty(name: str, location=(0, 0, 0), display="PLAIN_AXES", size=.18) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    obj.location = location
    obj.empty_display_type = display
    obj.empty_display_size = size
    collection("COLL__ASSET").objects.link(obj)
    return obj


def build_assembly(quality: int, mode: str, shell_glass: bool = False, exploded: float = 0.0,
                   prefix: str = "", hotspots: bool = False) -> tuple[bpy.types.Object, dict[str, bpy.types.Object]]:
    root = create_empty(f"{prefix}C_TURBINE_ROOT")
    root["asset_id"] = "C_dismantlable_wind_turbine_v1_precision"
    root["units"] = "meter"
    root["up_axis"] = "+Z"
    root["rotor_axis"] = "+Y"
    rotor = create_empty(f"{prefix}ROTOR__ASSEMBLY", HUB)
    rotor["display_name"] = "转子总成"
    rotor["rotation_axis"] = "Y"
    rotor["rpm"] = 8.5
    parent_keep_world(rotor, root)
    result = {}
    for canonical in [item["name"] for item in SPEC["parts"]]:
        if canonical == "PART__NACELLE_SHELL":
            objects = [create_capsule_shell("nacelle_shell", quality)]
        elif canonical.startswith("PART__BLADE_"):
            angle = {"PART__BLADE_A": 0, "PART__BLADE_B": 120, "PART__BLADE_C": 240}[canonical]
            objects = [create_blade(canonical.lower(), angle, quality)]
        else:
            objects = BUILDERS[canonical](quality)
        part = join_part(objects, canonical, mode, prefix)
        if not prefix:
            tag_part(part, canonical, quality)
        parent_keep_world(part, rotor if canonical in {
            "PART__SPINNER", "PART__HUB", "PART__BLADE_A", "PART__BLADE_B", "PART__BLADE_C", "PART__MAIN_SHAFT"
        } else root)
        if exploded:
            vector = Vector(part_spec(canonical)["explode_vector"])
            part.location += vector * exploded
        if canonical == "PART__NACELLE_SHELL" and shell_glass:
            part.data.materials.clear()
            part.data.materials.append(glass_material())
        result[canonical] = part
    if hotspots and not prefix:
        for name, target, location in SPEC["hotspots"]:
            marker = create_empty(name, location, "SPHERE", .075)
            marker["target"] = target
            marker["display_name"] = part_spec(target)["display_name"]
            marker["interactive"] = True
            parent_keep_world(marker, root)
    return root, result


def setup_scene(camera_mode: str = "full", transparent=False) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 820
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = transparent
    scene.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.color = (.006, .012, .014)
    world = scene.world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (.006, .014, .017, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = .24
    positions = {
        "full": ((12.2, -18.0, 8.2), (0, .25, 4.42), 55),
        "front": ((0, -19.0, 5.25), (0, -.15, 4.48), 55),
        "side": ((18.0, .45, 5.45), (0, .45, 4.48), 55),
        "rear": ((0, 19.0, 5.25), (0, .45, 4.48), 55),
        "top": ((7.8, -9.8, 13.8), (0, .25, 4.4), 52),
        "detail": ((5.0, -6.8, 7.6), (0, .45, 6.48), 48),
        "detail_side": ((6.8, .25, 7.0), (0, .65, 6.50), 45),
    }
    location, target, lens = positions[camera_mode]
    bpy.ops.object.camera_add(location=location)
    camera = bpy.context.object
    camera.name = "RENDER_CAMERA"
    camera.data.lens = lens
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera
    for name, loc, energy, size, color in [
        ("KEY", (4, -6, 12), 1650, 6.0, (0.72, .92, 1.0)),
        ("FILL", (-6, -2, 8), 1050, 5.0, (0.18, .64, .72)),
        ("RIM", (2, 7, 10), 1350, 4.0, (.20, .80, .82)),
    ]:
        bpy.ops.object.light_add(type="AREA", location=loc)
        light = bpy.context.object
        light.name = f"LIGHT__{name}"
        light.data.energy, light.data.shape, light.data.size, light.data.color = energy, "DISK", size, color
        light.rotation_euler = (Vector((0, .4, 5.2)) - light.location).to_track_quat("-Z", "Y").to_euler()
    if not transparent:
        bpy.ops.mesh.primitive_plane_add(size=44, location=(0, 0, -.02))
        floor = bpy.context.object
        floor.name = "RENDER_FLOOR"
        floor.data.materials.append(simple_material("MAT__FLOOR", (.008, .015, .018, 1), .55, .10))


def render(path: Path, camera_mode: str = "full") -> None:
    setup_scene(camera_mode)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def save_stage(name: str, camera_mode: str = "full") -> None:
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_DIR / f"{name}.blend"))
    render(RENDER_DIR / f"{name}.png", camera_mode)


def object_metrics(objects: list[bpy.types.Object]) -> dict:
    vertices = triangles = draw_calls = 0
    for obj in objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        vertices += len(mesh.vertices)
        triangles += len(mesh.loop_triangles)
        draw_calls += max(1, len(mesh.materials))
        evaluated.to_mesh_clear()
    return {"mesh_objects": len([o for o in objects if o.type == 'MESH']), "vertices": vertices,
            "triangles": triangles, "draw_calls": draw_calls}


def export_glb(root: bpy.types.Object) -> Path:
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)
    path = EXPORT_DIR / "C_dismantlable_turbine_low_raw.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True,
        export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials="EXPORT", export_cameras=False, export_lights=False,
        export_extras=True, export_yup=True, export_apply=True,
        export_animations=False, export_frame_range=False, export_attributes=True,
        export_vertex_color="NONE",
    )
    return path


def joined_duplicate(objects: list[bpy.types.Object], name: str) -> bpy.types.Object:
    copies = []
    for source in objects:
        copy = source.copy()
        copy.data = source.data.copy()
        copy.parent = None
        copy.matrix_world = source.matrix_world.copy()
        collection("COLL__BAKE").objects.link(copy)
        copies.append(copy)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in copies:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.join()
    copies[0].name = name
    return copies[0]


def bake_material(target: bpy.types.Image) -> bpy.types.Material:
    material = bpy.data.materials.new(f"MAT__BAKE_{target.name}")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = target
    nodes.active = tex
    links.new(shader.outputs[0], output.inputs[0])
    return material


def bake_actual(high_parts: dict[str, bpy.types.Object], low_parts: dict[str, bpy.types.Object]) -> dict:
    # A selected-to-active bake of the real assembly (not a proxy) is kept as raw audit evidence.
    high = joined_duplicate(list(high_parts.values()), "BAKE__HIGH_ASSEMBLY")
    low = joined_duplicate(list(low_parts.values()), "BAKE__LOW_ASSEMBLY")
    result = {"method": "Cycles selected-to-active, real high/low turbine assemblies", "success": True}
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    for kind, color in (("Normal", (.5, .5, 1, 1)), ("AO", (1, 1, 1, 1))):
        target = bpy.data.images.new(f"C_Turbine_{kind}_BakeRaw", width=1024, height=1024, alpha=False)
        target.generated_color = color
        target.colorspace_settings.name = "Non-Color"
        low.data.materials.clear()
        low.data.materials.append(bake_material(target))
        bpy.ops.object.select_all(action="DESELECT")
        high.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        try:
            bpy.ops.object.bake(type="NORMAL" if kind == "Normal" else "AO", margin=16,
                                use_selected_to_active=True, max_ray_distance=.12, cage_extrusion=.035,
                                normal_space="TANGENT", target="IMAGE_TEXTURES", use_clear=True)
        except Exception as exc:
            # Keep a deterministic raw image and report the Blender operator error.
            result["success"] = False
            result[f"{kind.lower()}_error"] = str(exc)
        target.filepath_raw = str(TEXTURE_DIR / f"C_Turbine_{kind}_BakeRaw.png")
        target.file_format = "PNG"
        target.save()
    bpy.data.objects.remove(high, do_unlink=True)
    bpy.data.objects.remove(low, do_unlink=True)
    return result


def remove_root(root: bpy.types.Object) -> None:
    for child in list(root.children_recursive):
        bpy.data.objects.remove(child, do_unlink=True)
    if root.name in bpy.data.objects:
        bpy.data.objects.remove(root, do_unlink=True)


def render_final_views(root: bpy.types.Object, parts: dict[str, bpy.types.Object]) -> None:
    # Save exterior view first.
    render(RENDER_DIR / "C08_export_ready.png", "full")
    for mode in ("front", "side", "rear", "top"):
        # remove previous render-only objects between views
        for obj in [o for o in bpy.data.objects if o.name.startswith("RENDER_") or o.name.startswith("LIGHT__")]:
            bpy.data.objects.remove(obj, do_unlink=True)
        render(RENDER_DIR / f"C08_view_{mode}.png", mode)
    shell = parts["PART__NACELLE_SHELL"]
    shell.data.materials.clear()
    shell.data.materials.append(glass_material())
    for mode, filename in (("detail", "C08_cutaway_detail.png"), ("detail_side", "C08_cutaway_side.png")):
        for obj in [o for o in bpy.data.objects if o.name.startswith("RENDER_") or o.name.startswith("LIGHT__")]:
            bpy.data.objects.remove(obj, do_unlink=True)
        render(RENDER_DIR / filename, mode)


def main() -> None:
    started = time.perf_counter()
    stages = []

    clear_scene()
    build_assembly(1, "colored", True, 1.65)
    save_stage("C01_structure_breakdown", "detail")
    stages.append("C01_structure_breakdown")

    clear_scene()
    build_assembly(0, "clay", False)
    save_stage("C02_base_shape")
    stages.append("C02_base_shape")

    clear_scene()
    build_assembly(1, "colored", False)
    save_stage("C03_shape_refined")
    stages.append("C03_shape_refined")

    clear_scene()
    build_assembly(2, "colored", True)
    save_stage("C04_highpoly_detail", "detail")
    stages.append("C04_highpoly_detail")

    clear_scene()
    build_assembly(1, "wire", False)
    save_stage("C05_lowpoly_retopology", "detail")
    stages.append("C05_lowpoly_retopology")

    clear_scene()
    build_assembly(1, "uv", False)
    save_stage("C06_uv_unwrapped", "detail")
    stages.append("C06_uv_unwrapped")

    clear_scene()
    high_root, high_parts = build_assembly(2, "pbr", False, prefix="HIGH__")
    low_root, low_parts = build_assembly(1, "pbr", True)
    bake_report = bake_actual(high_parts, low_parts)
    remove_root(high_root)
    save_stage("C07_baked_pbr", "detail")
    stages.append("C07_baked_pbr")

    clear_scene()
    root, parts = build_assembly(1, "pbr", False, hotspots=True)
    metrics = object_metrics([o for o in root.children_recursive if o.type == "MESH"])
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_DIR / "C08_export_ready.blend"))
    raw_glb = export_glb(root)
    render_final_views(root, parts)
    stages.append("C08_export_ready")

    # Restore the authoritative final file after temporary cutaway render material changes.
    bpy.ops.wm.open_mainfile(filepath=str(BLEND_DIR / "C08_export_ready.blend"))
    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "elapsed_seconds": round(time.perf_counter() - started, 2),
        "blender_version": bpy.app.version_string, "stages": stages, "metrics": metrics,
        "parts": len(SPEC["parts"]), "hotspots": len(SPEC["hotspots"]), "rotor_axis": "+Y",
        "raw_glb": str(raw_glb.relative_to(ROOT)), "bake": bake_report,
    }
    (REPORT_DIR / "blender_pipeline_metrics.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (REPORT_DIR / "bake_manifest.json").write_text(json.dumps(bake_report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
