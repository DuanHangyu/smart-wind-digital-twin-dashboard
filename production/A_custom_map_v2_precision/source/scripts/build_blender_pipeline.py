"""Build the precision-traced A map through eight non-destructive Blender stages."""

from __future__ import annotations

import json
import math
import time
from array import array
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.geometry import tessellate_polygon


SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
SOURCE_DIR = ROOT / "source"
GENERATED_DIR = SOURCE_DIR / "generated"
BLEND_DIR = ROOT / "blender"
RENDER_DIR = ROOT / "renders"
TEXTURE_DIR = ROOT / "textures/png"
EXPORT_DIR = ROOT / "export"
REPORT_DIR = ROOT / "reports"

SPEC = json.loads((SOURCE_DIR / "map_spec.json").read_text(encoding="utf-8"))
GEOMETRY = json.loads((GENERATED_DIR / "reference_geometry.json").read_text(encoding="utf-8"))
REGIONS = GEOMETRY["regions"]
OUTLINE = GEOMETRY["outline"]
DEPTH = float(SPEC["dimensions"]["depth_m"])
UV_MIN = float(SPEC["uv"]["min"])
UV_MAX = float(SPEC["uv"]["max"])
SIDE_V_MIN = float(SPEC["uv"]["side_v_min"])
SIDE_V_MAX = float(SPEC["uv"]["side_v_max"])

for directory in (BLEND_DIR, RENDER_DIR, TEXTURE_DIR, EXPORT_DIR, REPORT_DIR):
    directory.mkdir(parents=True, exist_ok=True)


def bounds(points: list[list[float]]) -> tuple[float, float, float, float]:
    return (
        min(point[0] for point in points), min(point[1] for point in points),
        max(point[0] for point in points), max(point[1] for point in points),
    )


GLOBAL_BOUNDS = bounds(OUTLINE["high"])


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
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 760
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.world.color = (0.006, 0.007, 0.008)
    scene.view_settings.look = "AgX - Medium High Contrast"


def collection(name: str) -> bpy.types.Collection:
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
    root = bpy.data.objects.new("A_CUSTOM_MAP_V2_ROOT", None)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.35
    root["asset_id"] = SPEC["asset"]
    root["asset_version"] = SPEC["version"]
    root["source"] = "pixel-traced reference_six_views_states top-middle panel"
    root["interactive_regions"] = len(REGIONS)
    root["units"] = "meters"
    bpy.context.scene.collection.objects.link(root)
    return root


def image(path: Path, non_color: bool = False) -> bpy.types.Image:
    result = bpy.data.images.load(str(path), check_existing=True)
    if non_color:
        try:
            result.colorspace_settings.name = "Non-Color"
        except Exception:
            pass
    return result


def simple_material(name: str, color: tuple[float, float, float, float], emission: float = 0.0) -> bpy.types.Material:
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = 0.38
    shader.inputs["Metallic"].default_value = 0.18
    emission_color = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
    if emission_color is not None:
        emission_color.default_value = color
    emission_strength = shader.inputs.get("Emission Strength")
    if emission_strength is not None:
        emission_strength.default_value = emission
    links.new(shader.outputs[0], output.inputs[0])
    return material


def outline_material() -> bpy.types.Material:
    return simple_material("MAT__CYAN_BOUNDARY_GLOW", (0.035, 0.78, 0.68, 1.0), emission=2.0)


def gltf_occlusion_group() -> bpy.types.NodeTree:
    group = bpy.data.node_groups.get("glTF Material Output")
    if group is not None:
        return group
    group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    group.nodes.new("NodeGroupOutput")
    return group


def pbr_material() -> bpy.types.Material:
    material = bpy.data.materials.get("MAT__MAP_PRECISION_PBR") or bpy.data.materials.new("MAT__MAP_PRECISION_PBR")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")

    base = nodes.new("ShaderNodeTexImage")
    base.name = "TEX__BASE_COLOR"
    base.image = image(TEXTURE_DIR / "Map_BaseColor.png")
    links.new(base.outputs["Color"], shader.inputs["Base Color"])

    orm_path = TEXTURE_DIR / "Map_ORM.png"
    if not orm_path.exists():
        orm_path = TEXTURE_DIR / "Map_ORM_Source.png"
    orm = nodes.new("ShaderNodeTexImage")
    orm.name = "TEX__ORM"
    orm.image = image(orm_path, non_color=True)
    separate = nodes.new("ShaderNodeSeparateColor")
    links.new(orm.outputs["Color"], separate.inputs["Color"])
    links.new(separate.outputs["Green"], shader.inputs["Roughness"])
    links.new(separate.outputs["Blue"], shader.inputs["Metallic"])

    normal_path = TEXTURE_DIR / "Map_Normal.png"
    if not normal_path.exists():
        normal_path = TEXTURE_DIR / "Map_Normal_Source.png"
    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.name = "TEX__NORMAL"
    normal_texture.image = image(normal_path, non_color=True)
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = 0.72
    links.new(normal_texture.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], shader.inputs["Normal"])

    occlusion = nodes.new("ShaderNodeGroup")
    occlusion.name = "glTF Material Output"
    occlusion.node_tree = gltf_occlusion_group()
    links.new(separate.outputs["Red"], occlusion.inputs["Occlusion"])

    emission_color = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
    if emission_color is not None:
        links.new(base.outputs["Color"], emission_color)
    emission_strength = shader.inputs.get("Emission Strength")
    if emission_strength is not None:
        emission_strength.default_value = 0.12
    links.new(shader.outputs[0], output.inputs[0])
    return material


def triangulate(polygon: list[list[float]]) -> list[tuple[int, int, int]]:
    vectors = [Vector((float(x), float(y), 0.0)) for x, y in polygon]
    triangles = tessellate_polygon([vectors])
    index = {(round(vector.x, 7), round(vector.y, 7)): i for i, vector in enumerate(vectors)}
    result = []
    for triangle in triangles:
        if triangle and isinstance(triangle[0], int):
            result.append(tuple(int(item) for item in triangle))
        else:
            result.append(tuple(index[(round(item.x, 7), round(item.y, 7))] for item in triangle))
    return result


def prism_mesh(
    name: str,
    polygon: list[list[float]],
    center: tuple[float, float],
    material: bpy.types.Material,
    add_uv: bool,
    bevel_width: float,
    bevel_segments: int,
) -> bpy.types.Object:
    cx, cy = center
    local = [(x - cx, y - cy) for x, y in polygon]
    count = len(local)
    vertices = [(x, y, DEPTH) for x, y in local] + [(x, y, 0.0) for x, y in local]
    top_tris_global = triangulate(polygon)
    faces: list[tuple[int, ...]] = list(top_tris_global)
    faces.extend(tuple(count + item for item in reversed(triangle)) for triangle in top_tris_global)
    for i in range(count):
        j = (i + 1) % count
        faces.append((i, j, count + j, count + i))

    mesh = bpy.data.meshes.new(f"MESH__{name}")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = (cx, cy, 0.0)
    obj.data.materials.append(material)

    if add_uv:
        min_x, min_y, max_x, max_y = GLOBAL_BOUNDS
        uv_layer = mesh.uv_layers.new(name="UVMap")
        top_count = len(top_tris_global)
        edge_lengths = []
        perimeter = 0.0
        for i in range(count):
            x1, y1 = local[i]
            x2, y2 = local[(i + 1) % count]
            edge_lengths.append(perimeter)
            perimeter += math.hypot(x2 - x1, y2 - y1)
        for face in mesh.polygons:
            for loop_index in face.loop_indices:
                vertex_index = mesh.loops[loop_index].vertex_index
                x, y, z = mesh.vertices[vertex_index].co
                if face.index < top_count:
                    world_x, world_y = x + cx, y + cy
                    uv_layer.data[loop_index].uv = (
                        UV_MIN + (UV_MAX - UV_MIN) * (world_x - min_x) / (max_x - min_x),
                        UV_MIN + (UV_MAX - UV_MIN) * (world_y - min_y) / (max_y - min_y),
                    )
                elif face.index >= top_count * 2:
                    edge_index = face.index - top_count * 2
                    start_u = edge_lengths[edge_index] / max(perimeter, 1e-8)
                    end_u = (edge_lengths[edge_index] + math.dist(local[edge_index], local[(edge_index + 1) % count])) / max(perimeter, 1e-8)
                    x_start, y_start = local[edge_index]
                    is_start = math.hypot(x - x_start, y - y_start) < 1e-5
                    uu = start_u if is_start else end_u
                    vv = SIDE_V_MAX if z > DEPTH * 0.5 else SIDE_V_MIN
                    uv_layer.data[loop_index].uv = (uu, vv)
                else:
                    world_x, world_y = x + cx, y + cy
                    uv_layer.data[loop_index].uv = (
                        UV_MIN + (UV_MAX - UV_MIN) * (world_x - min_x) / (max_x - min_x),
                        UV_MIN + (UV_MAX - UV_MIN) * (world_y - min_y) / (max_y - min_y),
                    )

    if bevel_width > 0:
        bevel = obj.modifiers.new("BEVEL__REFERENCE_EDGE", "BEVEL")
        bevel.width = bevel_width
        bevel.segments = bevel_segments
        bevel.limit_method = "ANGLE"
        bevel.angle_limit = math.radians(18)
        bevel.harden_normals = True
    return obj


def outline_curve(
    name: str,
    polygon: list[list[float]],
    center: tuple[float, float],
    parent: bpy.types.Object,
    high: bool,
) -> bpy.types.Object:
    cx, cy = center
    curve = bpy.data.curves.new(f"CURVE__{name}", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = float(SPEC["dimensions"]["outline_radius_m"]) * (1.1 if high else 1.0)
    curve.bevel_resolution = 1 if high else 0
    curve.resolution_u = 1
    spline = curve.splines.new("POLY")
    spline.points.add(len(polygon) - 1)
    for point, (x, y) in zip(spline.points, polygon):
        point.co = (x - cx, y - cy, DEPTH + float(SPEC["dimensions"]["outline_height_m"]), 1.0)
    spline.use_cyclic_u = True
    obj = bpy.data.objects.new(name, curve)
    obj.parent = parent
    obj.data.materials.append(outline_material())
    return obj


def create_regions(
    root: bpy.types.Object,
    detail: str,
    material: bpy.types.Material,
    add_uv: bool,
    bevel_width: float,
    bevel_segments: int,
    outlines: bool,
    exploded: bool = False,
) -> tuple[list[bpy.types.Object], list[bpy.types.Object]]:
    bodies = []
    outline_objects = []
    body_collection = collection("COLL__PARTS")
    fx_collection = collection("COLL__OUTLINES")
    key = f"{detail}_gap"
    for index, region in enumerate(REGIONS):
        center = tuple(region["centroid"])
        body = prism_mesh(
            f"PART__REGION_{region['id']}", region[key], center, material,
            add_uv, bevel_width, bevel_segments,
        )
        link_only(body, body_collection)
        body.parent = root
        body["part_type"] = "region"
        body["region_id"] = region["id"]
        body["display_name"] = region["name"]
        body["data_value"] = int(region["value"])
        body["interactive"] = True
        body["hotspot"] = f"HOTSPOT__REGION_{region['id']}"
        if exploded:
            cx, cy = center
            body.location.x += cx * 0.10
            body.location.y += cy * 0.10
            body.location.z = 0.12 + 0.11 * (index % 4)
        bodies.append(body)
        if outlines:
            outline = outline_curve(
                f"FX__OUTLINE_REGION_{region['id']}", region[detail], center, body, detail == "high"
            )
            fx_collection.objects.link(outline)
            outline_objects.append(outline)
    return bodies, outline_objects


def create_base_slab(root: bpy.types.Object, detail: str = "high") -> bpy.types.Object:
    material = simple_material("MAT__BASE_SHAPE", (0.028, 0.36, 0.33, 1.0), emission=0.04)
    base = prism_mesh("BASE__TRACED_OUTLINE", OUTLINE[detail], (0.0, 0.0), material, False, 0.0, 1)
    link_only(base, collection("COLL__BASE"))
    base.parent = root
    outer = outline_curve("FX__OUTER_REFERENCE_LINE", OUTLINE[detail], (0.0, 0.0), base, detail == "high")
    collection("COLL__OUTLINES").objects.link(outer)
    return base


def create_hotspots(root: bpy.types.Object) -> list[bpy.types.Object]:
    result = []
    target_collection = collection("COLL__HOTSPOTS")
    for region in REGIONS:
        hotspot = bpy.data.objects.new(f"HOTSPOT__REGION_{region['id']}", None)
        hotspot.empty_display_type = "SPHERE"
        hotspot.empty_display_size = 0.08
        hotspot.location = (*region["centroid"], DEPTH + 0.24)
        hotspot.parent = root
        hotspot["target"] = f"PART__REGION_{region['id']}"
        hotspot["region_id"] = region["id"]
        hotspot["display_name"] = region["name"]
        hotspot["data_value"] = int(region["value"])
        target_collection.objects.link(hotspot)
        result.append(hotspot)
    return result


def create_bake_target() -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []
    for region in REGIONS:
        polygon = region["low_gap"]
        base = len(vertices)
        vertices.extend((x, y, DEPTH) for x, y in polygon)
        faces.extend(tuple(base + index for index in triangle) for triangle in triangulate(polygon))
    mesh = bpy.data.meshes.new("MESH__BAKE_TARGET")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    target = bpy.data.objects.new("BAKE_TARGET__PRECISION_TOP", mesh)
    collection("COLL__BAKE").objects.link(target)
    min_x, min_y, max_x, max_y = GLOBAL_BOUNDS
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for face in mesh.polygons:
        for loop_index in face.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            x, y, _ = mesh.vertices[vertex_index].co
            uv_layer.data[loop_index].uv = (
                UV_MIN + (UV_MAX - UV_MIN) * (x - min_x) / (max_x - min_x),
                UV_MIN + (UV_MAX - UV_MIN) * (y - min_y) / (max_y - min_y),
            )
    return target


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


def bake(high_objects: list[bpy.types.Object], target: bpy.types.Object, kind: str) -> bpy.types.Image:
    size = int(SPEC["texture_size"])
    target_image = bpy.data.images.new(f"Map_{kind}", width=size, height=size, alpha=False)
    target_image.generated_color = (0.5, 0.5, 1.0, 1.0) if kind == "Normal" else (1.0, 1.0, 1.0, 1.0)
    try:
        target_image.colorspace_settings.name = "Non-Color"
    except Exception:
        pass
    target.data.materials.clear()
    target.data.materials.append(bake_material(target_image))
    bpy.ops.object.select_all(action="DESELECT")
    for obj in high_objects:
        obj.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 20
    scene.cycles.use_denoising = False
    bpy.ops.object.bake(
        type="NORMAL" if kind == "Normal" else "AO",
        margin=16,
        use_selected_to_active=True,
        max_ray_distance=0.10,
        cage_extrusion=0.035,
        normal_space="TANGENT",
        target="IMAGE_TEXTURES",
        use_clear=True,
    )
    target_image.filepath_raw = str(TEXTURE_DIR / f"Map_{kind}.png")
    target_image.file_format = "PNG"
    target_image.save()
    return target_image


def combine_orm(ao: bpy.types.Image) -> None:
    rough = image(TEXTURE_DIR / "Map_Roughness.png", non_color=True)
    metallic = image(TEXTURE_DIR / "Map_Metallic.png", non_color=True)
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
    orm = bpy.data.images.new("Map_ORM", width=size, height=size, alpha=False)
    orm.pixels.foreach_set(result)
    orm.filepath_raw = str(TEXTURE_DIR / "Map_ORM.png")
    orm.file_format = "PNG"
    orm.save()


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def preview_materials() -> bpy.types.Object:
    floor_material = simple_material("MAT__FLOOR", (0.006, 0.008, 0.009, 1.0))
    bpy.ops.mesh.primitive_plane_add(size=42, location=(0, 0, -0.045))
    floor = bpy.context.object
    floor.name = "PREVIEW__FLOOR"
    floor.data.materials.append(floor_material)
    floor["exclude_from_export"] = True
    return floor


def setup_preview(camera_mode: str = "threequarter") -> None:
    for obj in list(bpy.data.objects):
        if obj.name.startswith(("Camera__", "Light__", "PREVIEW__")):
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.scene.render.engine = "BLENDER_EEVEE"
    floor = preview_materials()
    floor.hide_render = camera_mode in {"top", "side"}
    camera_data = bpy.data.cameras.new("Camera__Preview")
    camera = bpy.data.objects.new("Camera__Preview", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    if camera_mode == "top":
        camera.location = (0.0, 0.0, 16.0)
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = 13.65
        look_at(camera, Vector((0.0, 0.0, 0.25)))
    elif camera_mode == "side":
        camera.location = (0.0, -15.0, 0.40)
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = 13.65
        look_at(camera, Vector((0.0, 0.0, 0.40)))
    elif camera_mode == "rear":
        camera.location = (11.0, 15.5, 10.5)
        camera_data.lens = 58
        look_at(camera, Vector((0.0, 0.0, 0.25)))
    else:
        camera.location = (11.0, -17.0, 11.5)
        camera_data.lens = 58
        look_at(camera, Vector((0.0, 0.0, 0.25)))
    bpy.context.scene.camera = camera

    key_data = bpy.data.lights.new("Light__Key", "AREA")
    key_data.energy = 560
    key_data.shape = "DISK"
    key_data.size = 7.5
    key = bpy.data.objects.new("Light__Key", key_data)
    key.location = (-5.5, -5.0, 10.0)
    look_at(key, Vector((0, 0, 0)))
    bpy.context.scene.collection.objects.link(key)

    fill_data = bpy.data.lights.new("Light__Fill", "AREA")
    fill_data.energy = 230
    fill_data.color = (0.12, 0.8, 0.78)
    fill_data.size = 6.0
    fill = bpy.data.objects.new("Light__Fill", fill_data)
    fill.location = (6.0, 4.0, 5.5)
    look_at(fill, Vector((0, 0, 0)))
    bpy.context.scene.collection.objects.link(fill)

    rim_data = bpy.data.lights.new("Light__Rim", "AREA")
    rim_data.energy = 320
    rim_data.color = (0.08, 1.0, 0.9)
    rim_data.size = 4.0
    rim = bpy.data.objects.new("Light__Rim", rim_data)
    rim.location = (-4.0, 5.0, 3.0)
    look_at(rim, Vector((0, 0, 0.4)))
    bpy.context.scene.collection.objects.link(rim)


def save_stage(stage: str, camera_mode: str = "threequarter") -> None:
    setup_preview(camera_mode)
    bpy.context.scene.render.filepath = str(RENDER_DIR / f"{stage}.png")
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_DIR / f"{stage}.blend"), check_existing=False)
    bpy.ops.render.render(write_still=True)


def render_additional_view(name: str, camera_mode: str) -> None:
    for obj in list(bpy.data.objects):
        if obj.name.startswith(("Camera__", "Light__", "PREVIEW__")):
            bpy.data.objects.remove(obj, do_unlink=True)
    setup_preview(camera_mode)
    bpy.context.scene.render.filepath = str(RENDER_DIR / f"{name}.png")
    bpy.ops.render.render(write_still=True)


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
    path = EXPORT_DIR / "A_custom_map_v2_low_raw.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True,
        # Three.js derives the tangent basis from UV derivatives when a normal
        # map is present. Omitting explicit tangents avoids redundant GPU data
        # and prevents degenerate-tangent warnings on very small traced edges.
        export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials="EXPORT", export_cameras=False, export_lights=False,
        export_extras=True, export_yup=True, export_apply=True,
        export_animations=False, export_frame_range=False,
        export_attributes=True, export_vertex_color="NONE",
    )
    return path


def main() -> None:
    started = time.perf_counter()
    stages = []

    clear_scene()
    root = create_root()
    create_regions(root, "high", simple_material("MAT__STRUCTURE", (0.025, 0.34, 0.31, 1.0)), False, 0.0, 1, True, exploded=True)
    save_stage("A01_structure_breakdown")
    stages.append("A01_structure_breakdown")

    clear_scene()
    root = create_root()
    create_base_slab(root, "high")
    save_stage("A02_base_shape", "top")
    stages.append("A02_base_shape")

    clear_scene()
    root = create_root()
    create_regions(root, "high", simple_material("MAT__REFINED", (0.028, 0.37, 0.34, 1.0)), False, 0.015, 1, True)
    save_stage("A03_shape_refined")
    stages.append("A03_shape_refined")

    clear_scene()
    root = create_root()
    high_bodies, _ = create_regions(
        root, "high", simple_material("MAT__HIGH", (0.028, 0.38, 0.35, 1.0)),
        True, float(SPEC["dimensions"]["high_bevel_m"]), 3, True,
    )
    save_stage("A04_highpoly_detail")
    stages.append("A04_highpoly_detail")

    clear_scene()
    root = create_root()
    low_bodies, low_outlines = create_regions(
        root, "low", simple_material("MAT__LOW", (0.028, 0.37, 0.34, 1.0)),
        True, float(SPEC["dimensions"]["low_bevel_m"]), 1, True,
    )
    low_metrics = object_metrics(low_bodies + low_outlines)
    save_stage("A05_lowpoly_retopology")
    stages.append("A05_lowpoly_retopology")

    clear_scene()
    root = create_root()
    uv_bodies, uv_outlines = create_regions(
        root, "low", pbr_material(), True,
        float(SPEC["dimensions"]["low_bevel_m"]), 1, True,
    )
    save_stage("A06_uv_unwrapped", "top")
    stages.append("A06_uv_unwrapped")

    # Bake high-contour/high-bevel information into the shared low-poly UV atlas.
    for obj in list(bpy.data.objects):
        if obj.name.startswith("FX__OUTLINE_"):
            obj.hide_render = True
    bake_root = bpy.data.objects.new("BAKE__HIGH_ROOT", None)
    bpy.context.scene.collection.objects.link(bake_root)
    bake_high, _ = create_regions(
        bake_root, "high", simple_material("MAT__BAKE_HIGH", (0.6, 0.6, 0.6, 1.0)),
        True, float(SPEC["dimensions"]["high_bevel_m"]), 3, False,
    )
    target = create_bake_target()
    normal = bake(bake_high, target, "Normal")
    ao = bake(bake_high, target, "AO")
    combine_orm(ao)
    for obj in bake_high:
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.objects.remove(bake_root, do_unlink=True)
    bpy.data.objects.remove(target, do_unlink=True)
    for obj in uv_bodies:
        obj.data.materials.clear()
        obj.data.materials.append(pbr_material())
    for obj in list(bpy.data.objects):
        if obj.name.startswith("FX__OUTLINE_"):
            obj.hide_render = False
    save_stage("A07_baked_pbr")
    stages.append("A07_baked_pbr")

    root = bpy.data.objects.get("A_CUSTOM_MAP_V2_ROOT")
    hotspots = create_hotspots(root)
    root["triangle_budget"] = int(SPEC["performance"]["triangle_budget"])
    root["draw_call_budget"] = int(SPEC["performance"]["draw_call_budget"])
    root["texture_size"] = int(SPEC["texture_size"])
    root["pipeline_stage"] = "export_ready"
    save_stage("A08_export_ready")
    stages.append("A08_export_ready")
    render_additional_view("A08_view_top", "top")
    render_additional_view("A08_view_side", "side")
    render_additional_view("A08_view_rear", "rear")

    raw_glb = export_glb(root)
    final_objects = [obj for obj in root.children_recursive if obj.type in {"MESH", "CURVE"}]
    final_metrics = object_metrics(final_objects)
    report = {
        "asset": SPEC["asset"],
        "blender": bpy.app.version_string,
        "stages": stages,
        "regions": len(uv_bodies),
        "hotspots": len(hotspots),
        "source_trace": json.loads((REPORT_DIR / "trace_metrics.json").read_text(encoding="utf-8")),
        "lowpoly": low_metrics,
        "final": final_metrics,
        "budgets": SPEC["performance"],
        "raw_glb": str(raw_glb),
        "raw_glb_bytes": raw_glb.stat().st_size,
        "baked_textures": [
            "Map_BaseColor.png", "Map_Normal.png", "Map_AO.png",
            "Map_Roughness.png", "Map_Metallic.png", "Map_ORM.png",
        ],
        "duration_seconds": round(time.perf_counter() - started, 3),
    }
    (REPORT_DIR / "blender_pipeline_metrics.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (REPORT_DIR / "bake_manifest.json").write_text(
        json.dumps({
            "normal": {"method": "selected-to-active", "source": "14 high-contour beveled PART meshes", "target": "BAKE_TARGET__PRECISION_TOP", "size": SPEC["texture_size"]},
            "ao": {"method": "selected-to-active", "source": "14 high-contour beveled PART meshes", "target": "BAKE_TARGET__PRECISION_TOP", "size": SPEC["texture_size"]},
            "uv_layer": "UVMap", "margin_pixels": 16,
        }, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("PIPELINE_REPORT=" + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
