"""Build B artistic wind-farm terrain through eight non-destructive Blender stages."""

from __future__ import annotations

import json
import math
import time
from array import array
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.geometry import tessellate_polygon


SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
SOURCE = ROOT / "source"
GENERATED = SOURCE / "generated"
BLEND_DIR = ROOT / "blender"
RENDER_DIR = ROOT / "renders"
TEXTURE_DIR = ROOT / "textures/png"
EXPORT_DIR = ROOT / "export"
REPORT_DIR = ROOT / "reports"

SPEC = json.loads((SOURCE / "terrain_spec.json").read_text(encoding="utf-8"))
STRUCTURE = json.loads((GENERATED / "terrain_structure.json").read_text(encoding="utf-8"))
FIELDS = np.load(GENERATED / "terrain_fields.npz")
WIDTH = float(SPEC["dimensions"]["width_m"])
DEPTH = float(SPEC["dimensions"]["depth_m"])
BASE_HEIGHT = float(SPEC["dimensions"]["base_height_m"])
LAKE_Z = float(SPEC["dimensions"]["lake_surface_m"])

for directory in (BLEND_DIR, RENDER_DIR, TEXTURE_DIR, EXPORT_DIR, REPORT_DIR):
    directory.mkdir(parents=True, exist_ok=True)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes, bpy.data.curves, bpy.data.materials,
        bpy.data.cameras, bpy.data.lights,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 760
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.72, 0.72, 0.72)
    scene.world.use_nodes = True
    world_background = scene.world.node_tree.nodes.get("Background")
    world_background.inputs["Color"].default_value = (0.78, 0.78, 0.78, 1)
    world_background.inputs["Strength"].default_value = 0.72
    scene.view_settings.look = "AgX - Medium High Contrast"


def get_collection(name: str) -> bpy.types.Collection:
    result = bpy.data.collections.get(name)
    if result is None:
        result = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(result)
    return result


def link_only(obj: bpy.types.Object, target: bpy.types.Collection) -> None:
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    target.objects.link(obj)


def create_root() -> bpy.types.Object:
    root = bpy.data.objects.new("B_WINDFARM_TERRAIN_ROOT", None)
    root.empty_display_type = "PLAIN_AXES"
    root["asset_id"] = SPEC["asset"]
    root["asset_version"] = SPEC["version"]
    root["units"] = "meters"
    root["source"] = "three locked multiview references"
    root["terrain_ratio"] = WIDTH / DEPTH
    bpy.context.scene.collection.objects.link(root)
    return root


def simple_material(
    name: str,
    color: tuple[float, float, float, float],
    roughness: float = 0.55,
    metallic: float = 0.0,
    emission: float = 0.0,
) -> bpy.types.Material:
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
    if emission_color is not None:
        emission_color.default_value = color
    emission_strength = shader.inputs.get("Emission Strength")
    if emission_strength is not None:
        emission_strength.default_value = emission
    links.new(shader.outputs[0], output.inputs[0])
    return material


def image(path: Path, non_color: bool = False) -> bpy.types.Image:
    result = bpy.data.images.load(str(path), check_existing=True)
    if non_color:
        try:
            result.colorspace_settings.name = "Non-Color"
        except Exception:
            pass
    return result


def gltf_occlusion_group() -> bpy.types.NodeTree:
    group = bpy.data.node_groups.get("glTF Material Output")
    if group is not None:
        return group
    group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    group.nodes.new("NodeGroupOutput")
    return group


def terrain_pbr_material() -> bpy.types.Material:
    material = bpy.data.materials.get("MAT__TERRAIN_PBR") or bpy.data.materials.new("MAT__TERRAIN_PBR")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")

    base = nodes.new("ShaderNodeTexImage")
    base.name = "TEX__TERRAIN_BASE_COLOR"
    base.image = image(TEXTURE_DIR / "Terrain_BaseColor.png")
    links.new(base.outputs["Color"], shader.inputs["Base Color"])

    orm_path = TEXTURE_DIR / "Terrain_ORM.png"
    if not orm_path.exists():
        orm_path = TEXTURE_DIR / "Terrain_ORM_Source.png"
    orm = nodes.new("ShaderNodeTexImage")
    orm.name = "TEX__TERRAIN_ORM"
    orm.image = image(orm_path, non_color=True)
    separate = nodes.new("ShaderNodeSeparateColor")
    links.new(orm.outputs["Color"], separate.inputs["Color"])
    links.new(separate.outputs["Green"], shader.inputs["Roughness"])
    links.new(separate.outputs["Blue"], shader.inputs["Metallic"])

    normal_path = TEXTURE_DIR / "Terrain_Normal.png"
    if not normal_path.exists():
        normal_path = TEXTURE_DIR / "Terrain_Normal_Source.png"
    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.name = "TEX__TERRAIN_NORMAL"
    normal_texture.image = image(normal_path, non_color=True)
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = 0.58
    links.new(normal_texture.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], shader.inputs["Normal"])

    occlusion = nodes.new("ShaderNodeGroup")
    occlusion.name = "glTF Material Output"
    occlusion.node_tree = gltf_occlusion_group()
    links.new(separate.outputs["Red"], occlusion.inputs["Occlusion"])
    links.new(shader.outputs[0], output.inputs[0])
    return material


def uv_checker_material() -> bpy.types.Material:
    material = bpy.data.materials.get("MAT__UV_CHECKER") or bpy.data.materials.new("MAT__UV_CHECKER")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image(TEXTURE_DIR / "Terrain_UV_Checker.png")
    links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    shader.inputs["Roughness"].default_value = 0.7
    links.new(shader.outputs[0], output.inputs[0])
    return material


def wireframe_material() -> bpy.types.Material:
    material = bpy.data.materials.get("MAT__CYAN_WIREFRAME") or bpy.data.materials.new("MAT__CYAN_WIREFRAME")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    wire = nodes.new("ShaderNodeWireframe")
    wire.use_pixel_size = False
    wire.inputs["Size"].default_value = 0.007
    dark = nodes.new("ShaderNodeBsdfPrincipled")
    dark.inputs["Base Color"].default_value = (0.002, 0.014, 0.017, 1)
    dark.inputs["Roughness"].default_value = 0.88
    glow = nodes.new("ShaderNodeEmission")
    glow.inputs["Color"].default_value = (0.0, 0.76, 0.82, 1)
    glow.inputs["Strength"].default_value = 2.8
    mix = nodes.new("ShaderNodeMixShader")
    links.new(wire.outputs["Fac"], mix.inputs[0])
    links.new(dark.outputs[0], mix.inputs[1])
    links.new(glow.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], output.inputs[0])
    return material


def terrain_mesh(
    name: str,
    field: np.ndarray,
    material: bpy.types.Material,
    add_uv: bool = True,
    include_skirt: bool = True,
) -> bpy.types.Object:
    rows, columns = field.shape
    vertices: list[tuple[float, float, float]] = []
    for row in range(rows):
        y = DEPTH * 0.5 - row / (rows - 1) * DEPTH
        for column in range(columns):
            x = -WIDTH * 0.5 + column / (columns - 1) * WIDTH
            vertices.append((x, y, BASE_HEIGHT + float(field[row, column])))
    faces: list[tuple[int, ...]] = []
    for row in range(rows - 1):
        for column in range(columns - 1):
            a = row * columns + column
            b = a + 1
            c = a + columns
            d = c + 1
            if (row + column) % 2 == 0:
                faces.extend([(a, c, d), (a, d, b)])
            else:
                faces.extend([(a, c, b), (b, c, d)])
    top_face_count = len(faces)

    perimeter: list[int] = []
    perimeter.extend(range(0, columns))
    perimeter.extend(row * columns + columns - 1 for row in range(1, rows))
    perimeter.extend((rows - 1) * columns + column for column in range(columns - 2, -1, -1))
    perimeter.extend(row * columns for row in range(rows - 2, 0, -1))
    if include_skirt:
        skirt_start = len(vertices)
        vertices.extend((vertices[index][0], vertices[index][1], BASE_HEIGHT) for index in perimeter)
        for index, top_index in enumerate(perimeter):
            next_index = (index + 1) % len(perimeter)
            faces.append((top_index, perimeter[next_index], skirt_start + next_index, skirt_start + index))

    mesh = bpy.data.meshes.new(f"MESH__{name}")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(material)
    skirt_material_index = 0
    if include_skirt and material.name == "MAT__TERRAIN_PBR":
        skirt_material = simple_material("MAT__TERRAIN_SKIRT_DARK", (0.018, 0.045, 0.038, 1), 0.78, 0.04)
        obj.data.materials.append(skirt_material)
        skirt_material_index = 1
    get_collection("COLL__TERRAIN").objects.link(obj)
    for polygon in mesh.polygons:
        polygon.use_smooth = polygon.index < top_face_count
        if polygon.index >= top_face_count:
            polygon.material_index = skirt_material_index

    if add_uv:
        uv_layer = mesh.uv_layers.new(name="UVMap")
        for polygon in mesh.polygons:
            for loop_index in polygon.loop_indices:
                vertex_index = mesh.loops[loop_index].vertex_index
                x, y, z = mesh.vertices[vertex_index].co
                if polygon.index < top_face_count:
                    uv_layer.data[loop_index].uv = (x / WIDTH + 0.5, y / DEPTH + 0.5)
                else:
                    # Side skirts use a narrow shared atlas strip.
                    uv_layer.data[loop_index].uv = (x / WIDTH + 0.5, 0.025 if z > BASE_HEIGHT + 1e-5 else 0.0)
    obj["part_type"] = "terrain"
    obj["interactive"] = True
    obj["display_name"] = "艺术化风场地形"
    return obj


def create_base(root: bpy.types.Object, material: bpy.types.Material | None = None) -> bpy.types.Object:
    material = material or simple_material("MAT__BASE_DARK", (0.025, 0.04, 0.038, 1), 0.62, 0.12)
    bpy.ops.mesh.primitive_cube_add(location=(0, 0, BASE_HEIGHT * 0.5))
    obj = bpy.context.object
    obj.name = "PART__BASE"
    obj.dimensions = (WIDTH + 0.14, DEPTH + 0.14, BASE_HEIGHT)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new("BEVEL__BASE", "BEVEL")
    bevel.width = 0.045
    bevel.segments = 2
    obj.data.materials.append(material)
    obj.parent = root
    obj["part_type"] = "base"
    obj["interactive"] = False
    link_only(obj, get_collection("COLL__BASE"))
    return obj


def lake_polygon_world() -> list[tuple[float, float]]:
    return [(point[0] * WIDTH * 0.5, point[1] * DEPTH * 0.5) for point in STRUCTURE["lake"]["polygon_normalized"]]


def create_lake(root: bpy.types.Object, material: bpy.types.Material | None = None) -> bpy.types.Object:
    polygon = lake_polygon_world()
    vectors = [Vector((x, y, LAKE_Z)) for x, y in polygon]
    triangles = tessellate_polygon([vectors])
    index = {(round(vector.x, 7), round(vector.y, 7)): i for i, vector in enumerate(vectors)}
    faces = []
    for triangle in triangles:
        if triangle and isinstance(triangle[0], int):
            faces.append(tuple(int(value) for value in triangle))
        else:
            faces.append(tuple(index[(round(value.x, 7), round(value.y, 7))] for value in triangle))
    mesh = bpy.data.meshes.new("MESH__PART__LAKE")
    mesh.from_pydata([(x, y, LAKE_Z) for x, y in polygon], [], faces)
    mesh.update()
    obj = bpy.data.objects.new("PART__LAKE", mesh)
    get_collection("COLL__WATER").objects.link(obj)
    material = material or simple_material("MAT__LAKE", (0.075, 0.22, 0.27, 1), 0.20, 0.28)
    material.diffuse_color = (0.075, 0.22, 0.27, 1)
    obj.data.materials.append(material)
    solidify = obj.modifiers.new("SOLIDIFY__LAKE", "SOLIDIFY")
    solidify.thickness = 0.035
    bevel = obj.modifiers.new("BEVEL__LAKE_EDGE", "BEVEL")
    bevel.width = 0.018
    bevel.segments = 2
    obj.parent = root
    obj["part_type"] = "water"
    obj["interactive"] = True
    obj["display_name"] = "山地湖泊"
    obj["water_level_m"] = LAKE_Z
    return obj


def create_box(name: str, dimensions: tuple[float, float, float], location: tuple[float, float, float], material: bpy.types.Material) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return obj


def smooth(obj: bpy.types.Object) -> bpy.types.Object:
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def create_cylinder(
    name: str,
    radius: float,
    depth: float,
    location: tuple[float, float, float],
    material: bpy.types.Material,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    vertices: int = 20,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    return smooth(obj)


def create_beveled_box(
    name: str,
    dimensions: tuple[float, float, float],
    location: tuple[float, float, float],
    material: bpy.types.Material,
    bevel_width: float,
    bevel_segments: int = 3,
) -> bpy.types.Object:
    obj = create_box(name, dimensions, location, material)
    bevel = obj.modifiers.new(f"BEVEL__{name}", "BEVEL")
    bevel.width = bevel_width
    bevel.segments = bevel_segments
    bevel.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    return smooth(obj)


def create_uv_sphere(
    name: str,
    radius: float,
    location: tuple[float, float, float],
    material: bpy.types.Material,
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0),
    segments: int = 16,
    rings: int = 8,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return smooth(obj)


def join_meshes(objects: list[bpy.types.Object], name: str, parent: bpy.types.Object) -> bpy.types.Object:
    if not objects:
        raise ValueError(f"No meshes supplied for {name}")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    active = objects[0]
    bpy.context.view_layer.objects.active = active
    bpy.ops.object.join()
    active.name = name
    active.parent = parent
    link_only(active, get_collection("COLL__TURBINES"))
    return active


def create_blade_mesh(name: str, radius: float, material: bpy.types.Material) -> bpy.types.Object:
    # Seven airfoil stations preserve a broad root, tapered tip, twist, sweep and
    # slight upwind pre-bend without spending subdivision-level geometry.
    stations = [
        (radius * .17, .054, .018, 15.0, .000, .000),
        (radius * .25, .068, .017, 12.0, .002, -.001),
        (radius * .39, .060, .014, 9.0, .006, -.002),
        (radius * .56, .048, .011, 6.0, .012, -.004),
        (radius * .73, .034, .008, 3.5, .016, -.007),
        (radius * .89, .022, .006, 1.5, .015, -.011),
        (radius,       .010, .004, 0.5, .010, -.016),
    ]
    vertices: list[tuple[float, float, float]] = []
    for radial, chord, thickness, twist_degrees, sweep, prebend in stations:
        twist = math.radians(twist_degrees)
        cosine, sine = math.cos(twist), math.sin(twist)
        for chord_sign, thickness_sign in ((1, -1), (-1, -1), (-1, 1), (1, 1)):
            x = chord_sign * chord * .5
            y = thickness_sign * thickness * .5
            vertices.append((sweep + x * cosine - y * sine, prebend + x * sine + y * cosine, radial))
    faces: list[tuple[int, ...]] = []
    for station in range(len(stations) - 1):
        current, following = station * 4, (station + 1) * 4
        faces.extend([
            (current, current + 1, following + 1, following),
            (current + 3, following + 3, following + 2, current + 2),
            (current, following, following + 3, current + 3),
            (current + 1, current + 2, following + 2, following + 1),
        ])
    faces.extend([(0, 3, 2, 1), (24, 25, 26, 27)])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    get_collection("COLL__TURBINES").objects.link(obj)
    obj.data.materials.append(material)
    obj["airfoil_stations"] = len(stations)
    obj["blade_radius_m"] = radius
    obj["twist_root_degrees"] = 15.0
    obj["prebend_tip_m"] = -0.016
    return smooth(obj)


def create_turbine(root: bpy.types.Object, data: dict, material: bpy.types.Material | None = None) -> bpy.types.Object:
    material_override = material
    material = material or simple_material("MAT__TURBINE_WHITE", (0.82, 0.86, 0.84, 1), 0.30, 0.12)
    accent = material_override or simple_material("MAT__TURBINE_ACCENT", (0.12, 0.27, 0.28, 1), 0.38, 0.45)
    dark = material_override or simple_material("MAT__TURBINE_DARK", (0.025, 0.055, 0.058, 1), 0.48, 0.34)
    beacon = material_override or simple_material("MAT__TURBINE_BEACON", (0.82, 0.025, 0.012, 1), 0.24, 0.10, 0.35)
    tower_height = float(SPEC["dimensions"]["turbine_tower_m"])
    radius = float(SPEC["dimensions"]["turbine_rotor_radius_m"])
    part = bpy.data.objects.new(f"PART__TURBINE_{data['id']}", None)
    part.location = tuple(data["position"])
    part.empty_display_type = "PLAIN_AXES"
    part["part_type"] = "turbine"
    part["interactive"] = True
    part["display_name"] = data["name"]
    part["status"] = data["status"]
    part["power_kw"] = data["power_kw"]
    part["detail_level"] = "web_midpoly_v3"
    part["yaw_axis"] = "Z"
    part["components"] = "tower,flange,door,yaw,nacelle,shaft,spinner,blades,anemometer,beacon"
    part.parent = root
    get_collection("COLL__TURBINES").objects.link(part)

    body_meshes: list[bpy.types.Object] = []
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.058, radius2=0.031, depth=tower_height, location=(0, 0, tower_height * 0.5))
    tower = bpy.context.object
    tower.name = f"MESH__TOWER_{data['id']}"
    tower.data.materials.append(material)
    tower.parent = part
    link_only(tower, get_collection("COLL__TURBINES"))
    smooth(tower)
    body_meshes.append(tower)

    body_meshes.append(create_cylinder(f"MESH__BASE_FLANGE_{data['id']}", .074, .026, (0, 0, .013), accent, vertices=24))
    body_meshes.append(create_beveled_box(f"MESH__SERVICE_DOOR_{data['id']}", (.034, .008, .115), (0, -.057, .115), dark, .004, 2))
    body_meshes.append(create_cylinder(f"MESH__YAW_RING_{data['id']}", .044, .034, (0, 0, tower_height + .010), accent, vertices=24))

    hub_height = tower_height + 0.068
    nacelle = create_beveled_box(f"MESH__NACELLE_SHELL_{data['id']}", (.152, .335, .130), (0, .045, hub_height), material, .032, 3)
    body_meshes.append(nacelle)
    body_meshes.append(create_beveled_box(f"MESH__NACELLE_REAR_{data['id']}", (.132, .018, .090), (0, .219, hub_height), dark, .006, 2))
    body_meshes.append(create_beveled_box(f"MESH__NACELLE_HATCH_{data['id']}", (.006, .105, .062), (.078, .055, hub_height), accent, .003, 1))
    body_meshes.append(create_cylinder(f"MESH__MAIN_SHAFT_{data['id']}", .035, .105, (0, -.148, hub_height), dark, (math.pi / 2, 0, 0), 20))

    # Compact anemometer and aviation beacon keep the silhouette readable in a
    # close-up while remaining cheap after the static body is joined.
    sensor_center = Vector((0, .115, hub_height + .132))
    body_meshes.append(create_cylinder(f"MESH__SENSOR_MAST_{data['id']}", .006, .074, (0, .115, hub_height + .098), dark, vertices=12))
    for cup_index in range(3):
        angle = cup_index * math.tau / 3.0
        direction = Vector((math.cos(angle), math.sin(angle), 0))
        arm = create_box(
            f"MESH__ANEMOMETER_ARM_{data['id']}_{cup_index + 1}",
            (.055, .005, .005),
            tuple(sensor_center + direction * .0275),
            dark,
        )
        arm.rotation_euler.z = angle
        body_meshes.append(arm)
        cup_position = sensor_center + direction * .060
        cup = create_uv_sphere(
            f"MESH__ANEMOMETER_CUP_{data['id']}_{cup_index + 1}",
            .010,
            tuple(cup_position),
            dark,
            (1.0, .58, .72),
            10,
            5,
        )
        cup.rotation_euler.z = angle + math.pi * .5
        body_meshes.append(cup)
    body_meshes.append(create_uv_sphere(f"MESH__BEACON_{data['id']}", .011, (0, .025, hub_height + .083), beacon, (1.0, 1.0, .72), 10, 5))
    for obj in body_meshes[1:]:
        obj.parent = part
        link_only(obj, get_collection("COLL__TURBINES"))
    body = join_meshes(body_meshes, f"MESH__TURBINE_BODY_{data['id']}", part)
    body["component_group"] = "static_turbine_body"

    rotor = bpy.data.objects.new(f"ROTOR__TURBINE_{data['id']}", None)
    rotor.location = (0, -0.205, hub_height)
    rotor.rotation_euler.y = [math.radians(8), math.radians(-17), math.radians(23)][int(data["id"]) - 1]
    rotor["rotor_axis"] = "Y"
    rotor["rpm"] = [8.2, 7.1, 9.1][int(data["id"]) - 1]
    rotor["rotor_radius_m"] = radius
    rotor["hub_height_m"] = hub_height
    rotor.parent = part
    get_collection("COLL__TURBINES").objects.link(rotor)

    rotor_meshes: list[bpy.types.Object] = []
    hub = create_cylinder(f"MESH__HUB_RING_{data['id']}", .062, .072, (0, .018, 0), accent, (math.pi / 2, 0, 0), 24)
    hub.parent = rotor
    rotor_meshes.append(hub)
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=.059, radius2=.018, depth=.132, location=(0, -.068, 0), rotation=(math.pi / 2, 0, 0))
    spinner = bpy.context.object
    spinner.name = f"MESH__HUB_SPINNER_{data['id']}"
    spinner.data.materials.append(material)
    spinner.parent = rotor
    smooth(spinner)
    link_only(spinner, get_collection("COLL__TURBINES"))
    rotor_meshes.append(spinner)

    for blade_index in range(3):
        angle = blade_index * math.tau / 3.0
        collar = create_cylinder(
            f"MESH__PITCH_BEARING_{data['id']}_{blade_index + 1}",
            .028,
            .032,
            (0, 0, radius * .125),
            accent,
            vertices=18,
        )
        collar.rotation_euler.y = angle
        collar.parent = rotor
        rotor_meshes.append(collar)
        blade = create_blade_mesh(f"MESH__BLADE_{data['id']}_{blade_index + 1}", radius, material)
        blade.rotation_euler.y = angle
        blade.parent = rotor
        rotor_meshes.append(blade)
    rotor_mesh = join_meshes(rotor_meshes, f"MESH__ROTOR_ASSEMBLY_{data['id']}", rotor)
    rotor_mesh["component_group"] = "hub_spinner_and_three_blades"
    rotor_mesh["airfoil_stations_per_blade"] = 7
    return part


def create_hotspots(root: bpy.types.Object) -> list[bpy.types.Object]:
    result = []
    collection = get_collection("COLL__HOTSPOTS")
    for data in STRUCTURE["turbines"]:
        hotspot = bpy.data.objects.new(f"HOTSPOT__TURBINE_{data['id']}", None)
        hotspot.location = (
            data["position"][0], data["position"][1],
            data["position"][2] + float(SPEC["dimensions"]["turbine_tower_m"]) + 0.52,
        )
        hotspot.empty_display_type = "SPHERE"
        hotspot.empty_display_size = 0.09
        hotspot["target"] = f"PART__TURBINE_{data['id']}"
        hotspot["display_name"] = data["name"]
        hotspot["status"] = data["status"]
        hotspot["power_kw"] = data["power_kw"]
        hotspot.parent = root
        collection.objects.link(hotspot)
        result.append(hotspot)
    lake = bpy.data.objects.new("HOTSPOT__LAKE", None)
    center_x = sum(point[0] for point in STRUCTURE["lake"]["polygon_normalized"]) / len(STRUCTURE["lake"]["polygon_normalized"])
    center_y = sum(point[1] for point in STRUCTURE["lake"]["polygon_normalized"]) / len(STRUCTURE["lake"]["polygon_normalized"])
    lake.location = (center_x * WIDTH * 0.5, center_y * DEPTH * 0.5, LAKE_Z + 0.46)
    lake.empty_display_type = "SPHERE"
    lake.empty_display_size = 0.09
    lake["target"] = "PART__LAKE"
    lake["display_name"] = "山地湖泊"
    lake["status"] = "水位正常"
    lake["power_kw"] = 0
    lake.parent = root
    collection.objects.link(lake)
    result.append(lake)
    return result


def bake_material(target_image: bpy.types.Image) -> bpy.types.Material:
    material = bpy.data.materials.get("MAT__BAKE_TARGET") or bpy.data.materials.new("MAT__BAKE_TARGET")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = target_image
    nodes.active = texture
    material.node_tree.links.new(shader.outputs[0], output.inputs[0])
    return material


def bake(high: bpy.types.Object, low: bpy.types.Object, kind: str) -> bpy.types.Image:
    size = int(SPEC["texture_size"])
    target_image = bpy.data.images.new(f"Terrain_{kind}", width=size, height=size, alpha=False)
    target_image.generated_color = (0.5, 0.5, 1.0, 1.0) if kind == "Normal" else (1.0, 1.0, 1.0, 1.0)
    try:
        target_image.colorspace_settings.name = "Non-Color"
    except Exception:
        pass
    low.data.materials.clear()
    low.data.materials.append(bake_material(target_image))
    bpy.ops.object.select_all(action="DESELECT")
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = False
    bpy.ops.object.bake(
        type="NORMAL" if kind == "Normal" else "AO",
        margin=16,
        use_selected_to_active=True,
        max_ray_distance=0.48,
        cage_extrusion=0.16,
        normal_space="TANGENT",
        target="IMAGE_TEXTURES",
        use_clear=True,
    )
    target_image.filepath_raw = str(TEXTURE_DIR / f"Terrain_{kind}.png")
    target_image.file_format = "PNG"
    target_image.save()
    return target_image


def combine_orm(ao: bpy.types.Image) -> None:
    rough = image(TEXTURE_DIR / "Terrain_Roughness.png", non_color=True)
    metallic = image(TEXTURE_DIR / "Terrain_Metallic.png", non_color=True)
    size = int(SPEC["texture_size"])
    count = size * size * 4
    ao_pixels = array("f", [0.0]) * count
    rough_pixels = array("f", [0.0]) * count
    metallic_pixels = array("f", [0.0]) * count
    ao.pixels.foreach_get(ao_pixels)
    rough.pixels.foreach_get(rough_pixels)
    metallic.pixels.foreach_get(metallic_pixels)
    result = array("f", [0.0]) * count
    for index in range(0, count, 4):
        result[index] = ao_pixels[index]
        result[index + 1] = rough_pixels[index]
        result[index + 2] = metallic_pixels[index]
        result[index + 3] = 1.0
    orm = bpy.data.images.new("Terrain_ORM", width=size, height=size, alpha=False)
    orm.pixels.foreach_set(result)
    orm.filepath_raw = str(TEXTURE_DIR / "Terrain_ORM.png")
    orm.file_format = "PNG"
    orm.save()


def reinforce_baked_normal(baked: bpy.types.Image) -> None:
    """Combine selected-to-active output with authored erosion micro-normal."""
    authored = image(TEXTURE_DIR / "Terrain_Normal_Source.png", non_color=True)
    size = int(SPEC["texture_size"])
    count = size * size * 4
    baked_pixels = array("f", [0.0]) * count
    authored_pixels = array("f", [0.0]) * count
    baked.pixels.foreach_get(baked_pixels)
    authored.pixels.foreach_get(authored_pixels)
    result = array("f", [0.0]) * count
    for index in range(0, count, 4):
        bx = baked_pixels[index] * 2.0 - 1.0
        by = baked_pixels[index + 1] * 2.0 - 1.0
        ax = authored_pixels[index] * 2.0 - 1.0
        ay = authored_pixels[index + 1] * 2.0 - 1.0
        x = bx + ax * 0.28
        y = by + ay * 0.28
        z = max(0.12, 1.0 - x * x - y * y) ** 0.5
        length = max((x * x + y * y + z * z) ** 0.5, 1e-6)
        result[index] = x / length * 0.5 + 0.5
        result[index + 1] = y / length * 0.5 + 0.5
        result[index + 2] = z / length * 0.5 + 0.5
        result[index + 3] = 1.0
    baked.pixels.foreach_set(result)
    baked.filepath_raw = str(TEXTURE_DIR / "Terrain_Normal.png")
    baked.file_format = "PNG"
    baked.save()


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_preview(mode: str = "threequarter", wire: bool = False) -> None:
    for obj in list(bpy.data.objects):
        if obj.name.startswith(("Camera__", "Light__", "PREVIEW__")):
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.scene.render.engine = "BLENDER_EEVEE"
    bpy.context.scene.world.color = (0.004, 0.008, 0.009) if wire else (0.78, 0.78, 0.78)
    bpy.context.scene.world.use_nodes = True
    world_background = bpy.context.scene.world.node_tree.nodes.get("Background")
    world_background.inputs["Color"].default_value = (0.004, 0.008, 0.009, 1) if wire else (0.82, 0.82, 0.82, 1)
    world_background.inputs["Strength"].default_value = 0.18 if wire else 0.80
    floor_material = simple_material(
        "MAT__PREVIEW_FLOOR_WIRE" if wire else "MAT__PREVIEW_FLOOR_LIGHT",
        (0.003, 0.008, 0.009, 1) if wire else (0.58, 0.58, 0.58, 1),
        0.83,
    )
    bpy.ops.mesh.primitive_plane_add(size=48, location=(0, 0, -0.035))
    floor = bpy.context.object
    floor.name = "PREVIEW__FLOOR"
    floor.data.materials.append(floor_material)
    floor.hide_render = mode in {"top", "front", "side"}

    camera_data = bpy.data.cameras.new("Camera__Preview")
    camera = bpy.data.objects.new("Camera__Preview", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    if mode == "top":
        camera.location = (0, 0, 18.5)
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = 16.4
        look_at(camera, Vector((0, 0, 0.55)))
    elif mode == "front":
        camera.location = (0, -20.8, 6.4)
        camera_data.lens = 62
        look_at(camera, Vector((0, 0.3, 0.72)))
    elif mode == "side":
        camera.location = (20.8, 0, 6.4)
        camera_data.lens = 62
        look_at(camera, Vector((0, 0.2, 0.72)))
    elif mode == "rear":
        camera.location = (-13.1, 17.8, 12.2)
        camera_data.lens = 58
        look_at(camera, Vector((0, 0.25, 0.65)))
    else:
        camera.location = (13.6, -19.6, 13.4)
        camera_data.lens = 58
        look_at(camera, Vector((0, 0.18, 0.46)))
    bpy.context.scene.camera = camera

    key_data = bpy.data.lights.new("Light__Key", "AREA")
    key_data.energy = 980 if not wire else 390
    key_data.shape = "DISK"
    key_data.size = 8.0
    key = bpy.data.objects.new("Light__Key", key_data)
    key.location = (-6.0, -5.0, 12.0)
    look_at(key, Vector((0, 0, 0.4)))
    bpy.context.scene.collection.objects.link(key)

    fill_data = bpy.data.lights.new("Light__Fill", "AREA")
    fill_data.energy = 420 if not wire else 210
    fill_data.color = (0.86, 0.90, 0.84) if not wire else (0.26, 0.48, 0.42)
    fill_data.size = 7.0
    fill = bpy.data.objects.new("Light__Fill", fill_data)
    fill.location = (7.0, 4.0, 7.0)
    look_at(fill, Vector((0, 0, 0.5)))
    bpy.context.scene.collection.objects.link(fill)

    rim_data = bpy.data.lights.new("Light__Rim", "AREA")
    rim_data.energy = 180 if not wire else 330
    rim_data.color = (0.62, 0.70, 0.66) if not wire else (0.10, 0.68, 0.64)
    rim_data.size = 5.0
    rim = bpy.data.objects.new("Light__Rim", rim_data)
    rim.location = (-5.0, 6.0, 5.0)
    look_at(rim, Vector((0, 0, 0.8)))
    bpy.context.scene.collection.objects.link(rim)


def save_stage(stage: str, mode: str = "threequarter", wire: bool = False) -> None:
    setup_preview(mode, wire)
    bpy.context.scene.render.filepath = str(RENDER_DIR / f"{stage}.png")
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_DIR / f"{stage}.blend"), check_existing=False)
    bpy.ops.render.render(write_still=True)


def render_additional(name: str, mode: str) -> None:
    setup_preview(mode)
    bpy.context.scene.render.filepath = str(RENDER_DIR / f"{name}.png")
    bpy.ops.render.render(write_still=True)


def render_turbine_detail(name: str, part_name: str, mode: str) -> None:
    """Render an isolated turbine close-up for proportion and axis review."""
    setup_preview("threequarter")
    part = bpy.data.objects[part_name]
    origin = part.matrix_world.translation
    hub_height = float(SPEC["dimensions"]["turbine_tower_m"]) + .068
    hidden: list[tuple[bpy.types.Object, bool]] = []
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name.startswith("PREVIEW__"):
            continue
        owner = obj
        while owner.parent and not owner.name.startswith("PART__TURBINE_"):
            owner = owner.parent
        keep = owner.name == part_name or obj.name.startswith(("MESH__TURBINE_BODY_", "MESH__ROTOR_ASSEMBLY_")) and owner.name == part_name
        hidden.append((obj, obj.hide_render))
        obj.hide_render = not keep
    floor = bpy.data.objects.get("PREVIEW__FLOOR")
    if floor:
        floor.hide_render = False
        floor.location.z = origin.z - .025
    camera = bpy.context.scene.camera
    if mode == "front":
        camera.location = origin + Vector((0, -2.90, .80))
    elif mode == "side":
        camera.location = origin + Vector((2.90, 0, .84))
    else:
        camera.location = origin + Vector((2.10, -2.70, 1.18))
    camera.data.lens = 55 if mode != "threequarter" else 68
    look_at(camera, origin + Vector((0, 0, hub_height * .62)))
    scene = bpy.context.scene
    previous_resolution = (scene.render.resolution_x, scene.render.resolution_y)
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 1000
    scene.render.filepath = str(RENDER_DIR / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    scene.render.resolution_x, scene.render.resolution_y = previous_resolution
    for obj, previous in hidden:
        obj.hide_render = previous


def object_metrics(objects: list[bpy.types.Object]) -> dict:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    vertices = triangles = draw_calls = 0
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        vertices += len(mesh.vertices)
        triangles += len(mesh.loop_triangles)
        draw_calls += max(1, len(mesh.materials))
        evaluated.to_mesh_clear()
    return {"objects": len(objects), "vertices": vertices, "triangles": triangles, "draw_calls": draw_calls}


def export_glb(root: bpy.types.Object) -> Path:
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)
    path = EXPORT_DIR / "B_windfarm_terrain_low_raw.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True,
        export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials="EXPORT", export_cameras=False, export_lights=False,
        export_extras=True, export_yup=True, export_apply=True,
        export_animations=False, export_frame_range=False,
        export_attributes=True, export_vertex_color="NONE",
    )
    return path


def build_final_scene(material: bpy.types.Material) -> tuple[bpy.types.Object, list[bpy.types.Object], list[bpy.types.Object]]:
    root = create_root()
    terrain = terrain_mesh("PART__TERRAIN", FIELDS["low"], material, True, True)
    terrain.parent = root
    base = create_base(root)
    lake = create_lake(root)
    turbines = [create_turbine(root, data) for data in STRUCTURE["turbines"]]
    hotspots = create_hotspots(root)
    return root, [terrain, base, lake, *turbines], hotspots


def main() -> None:
    started = time.perf_counter()
    stages = []

    # B01 — exploded structure, using the web-resolution terrain for clear part ownership.
    clear_scene()
    root = create_root()
    terrain = terrain_mesh("PART__TERRAIN", FIELDS["low"], simple_material("MAT__STRUCTURE_TERRAIN", (0.10, 0.30, 0.24, 1), 0.66), True, True)
    terrain.parent = root
    create_base(root)
    lake = create_lake(root, simple_material("MAT__STRUCTURE_LAKE", (0.03, 0.45, 0.55, 1), 0.28, 0.22, 0.15))
    lake.location.z = 1.0
    for index, data in enumerate(STRUCTURE["turbines"]):
        turbine = create_turbine(root, data)
        turbine.location.z += 0.40 + index * 0.25
    save_stage("B01_structure_breakdown")
    stages.append("B01_structure_breakdown")

    # B02 — broad base form.
    clear_scene()
    root = create_root()
    terrain = terrain_mesh("PART__TERRAIN", FIELDS["base"], simple_material("MAT__BASE_FORM", (0.10, 0.27, 0.18, 1), 0.78), True, True)
    terrain.parent = root
    create_base(root)
    create_lake(root)
    save_stage("B02_base_shape")
    stages.append("B02_base_shape")

    # B03 — refined high-density mountain layout.
    clear_scene()
    root = create_root()
    terrain = terrain_mesh("PART__TERRAIN", FIELDS["high"], simple_material("MAT__REFINED", (0.13, 0.35, 0.22, 1), 0.72), True, True)
    terrain.parent = root
    create_base(root)
    create_lake(root)
    save_stage("B03_shape_refined")
    stages.append("B03_shape_refined")

    # B04 — high-poly bake source with rock/grass source material.
    clear_scene()
    root = create_root()
    terrain = terrain_mesh("PART__TERRAIN_HIGH", FIELDS["high"], terrain_pbr_material(), True, True)
    terrain.parent = root
    create_base(root)
    create_lake(root)
    for data in STRUCTURE["turbines"]:
        create_turbine(root, data)
    save_stage("B04_highpoly_detail")
    stages.append("B04_highpoly_detail")

    # B05 — low-poly topology in cyan wireframe mode.
    clear_scene()
    root = create_root()
    terrain = terrain_mesh("PART__TERRAIN", FIELDS["low"], wireframe_material(), True, True)
    terrain.parent = root
    create_base(root, simple_material("MAT__WIRE_BASE", (0.01, 0.05, 0.055, 1), 0.82))
    create_lake(root, simple_material("MAT__WIRE_LAKE", (0.01, 0.10, 0.13, 1), 0.3, 0.1))
    for data in STRUCTURE["turbines"]:
        create_turbine(root, data, simple_material("MAT__WIRE_TURBINE", (0.0, 0.62, 0.68, 1), 0.4, 0.2, 1.1))
    save_stage("B05_lowpoly_retopology", wire=True)
    stages.append("B05_lowpoly_retopology")

    # B06 — UV checker inspection.
    clear_scene()
    root = create_root()
    terrain = terrain_mesh("PART__TERRAIN", FIELDS["low"], uv_checker_material(), True, True)
    terrain.parent = root
    create_base(root)
    create_lake(root)
    save_stage("B06_uv_unwrapped", mode="top")
    stages.append("B06_uv_unwrapped")

    # B07 — selected-to-active Normal/AO bake.
    clear_scene()
    root = create_root()
    high = terrain_mesh("HIGH_SOURCE__TERRAIN", FIELDS["high"], simple_material("MAT__BAKE_SOURCE", (0.5, 0.5, 0.5, 1)), True, False)
    low = terrain_mesh("PART__TERRAIN", FIELDS["low"], simple_material("MAT__BAKE_LOW", (0.5, 0.5, 0.5, 1)), True, False)
    low.parent = root
    normal_image = bake(high, low, "Normal")
    ao_image = bake(high, low, "AO")
    reinforce_baked_normal(normal_image)
    combine_orm(ao_image)
    bpy.data.objects.remove(high, do_unlink=True)
    low.data.materials.clear()
    low.data.materials.append(terrain_pbr_material())
    create_base(root)
    create_lake(root)
    for data in STRUCTURE["turbines"]:
        create_turbine(root, data)
    save_stage("B07_baked_pbr")
    stages.append("B07_baked_pbr")

    # B08 — export-ready scene with PART/HOTSPOT metadata.
    clear_scene()
    root, parts, hotspots = build_final_scene(terrain_pbr_material())
    final_meshes = [obj for obj in root.children_recursive if obj.type == "MESH"]
    final_metrics = object_metrics(final_meshes)
    save_stage("B08_export_ready")
    render_additional("B08_view_top", "top")
    render_additional("B08_view_front", "front")
    render_additional("B08_view_side", "side")
    render_additional("B08_view_rear", "rear")
    render_turbine_detail("B08_turbine_detail_front", "PART__TURBINE_02", "front")
    render_turbine_detail("B08_turbine_detail_side", "PART__TURBINE_02", "side")
    render_turbine_detail("B08_turbine_detail_threequarter", "PART__TURBINE_02", "threequarter")
    raw_glb = export_glb(root)
    stages.append("B08_export_ready")

    report = {
        "asset": SPEC["asset"],
        "blender": bpy.app.version_string,
        "stages": stages,
        "parts": 6,
        "hotspots": len(hotspots),
        "turbines": 3,
        "turbine_detail": {
            "tower_height_m": float(SPEC["dimensions"]["turbine_tower_m"]),
            "rotor_radius_m": float(SPEC["dimensions"]["turbine_rotor_radius_m"]),
            "airfoil_stations_per_blade": 7,
            "static_body_meshes": 3,
            "rotor_assembly_meshes": 3,
            "rotor_axis": "local Y",
        },
        "final": final_metrics,
        "budgets": SPEC["performance"],
        "raw_glb": str(raw_glb),
        "raw_glb_bytes": raw_glb.stat().st_size,
        "baked_textures": [
            "Terrain_BaseColor.png", "Terrain_Normal.png", "Terrain_AO.png",
            "Terrain_Roughness.png", "Terrain_Metallic.png", "Terrain_ORM.png",
        ],
        "duration_seconds": round(time.perf_counter() - started, 3),
    }
    (REPORT_DIR / "blender_pipeline_metrics.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (REPORT_DIR / "bake_manifest.json").write_text(
        json.dumps({
            "normal": {"method": "selected-to-active", "source": "321x207 reference-driven high terrain", "target": "161x105 web terrain", "size": SPEC["texture_size"]},
            "ao": {"method": "selected-to-active", "source": "321x207 reference-driven high terrain", "target": "161x105 web terrain", "size": SPEC["texture_size"]},
            "uv_layer": "UVMap", "margin_pixels": 16,
        }, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"PIPELINE_REPORT={json.dumps(report, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
