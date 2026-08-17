"""Build every Blender stage for the A_CUSTOM_MAP asset.

Run with:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python build_blender_pipeline.py
"""

from __future__ import annotations

import json
import math
import sys
import time
from array import array
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from mathutils.geometry import tessellate_polygon

SCRIPT_DIR = Path(__file__).resolve().parent
ASSET_ROOT = SCRIPT_DIR.parents[1]
SOURCE_DIR = ASSET_ROOT / "source"
GENERATED_DIR = SOURCE_DIR / "generated"
BLEND_DIR = ASSET_ROOT / "blender"
TEXTURE_DIR = ASSET_ROOT / "textures" / "png"
EXPORT_DIR = ASSET_ROOT / "export"
RENDER_DIR = ASSET_ROOT / "renders"
REPORT_DIR = ASSET_ROOT / "reports"
sys.path.insert(0, str(SCRIPT_DIR))

from map_geometry import bounds, centroid, load_spec, point_in_polygon  # noqa: E402

SPEC = load_spec(SOURCE_DIR / "map_spec.json")
REGION_DATA = json.loads((GENERATED_DIR / "map_regions.json").read_text(encoding="utf-8"))
REGIONS = REGION_DATA["regions"]
REGIONS_WITH_GAP = REGION_DATA["regions_with_gap"]
GLOBAL_BOUNDS = bounds([region["polygon"] for region in REGIONS])
DEPTH = float(SPEC["dimensions"]["extrusion_depth"])

for directory in (BLEND_DIR, TEXTURE_DIR, EXPORT_DIR, RENDER_DIR, REPORT_DIR):
    directory.mkdir(parents=True, exist_ok=True)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.003, 0.012, 0.014)
    scene.view_settings.look = "AgX - Medium High Contrast"


def get_or_create_collection(name: str) -> bpy.types.Collection:
    collection = bpy.data.collections.get(name)
    if collection is None:
        collection = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(collection)
    return collection


def link_only(obj: bpy.types.Object, collection: bpy.types.Collection) -> None:
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def create_root() -> bpy.types.Object:
    root = bpy.data.objects.new("A_CUSTOM_MAP_ROOT", None)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.45
    root["asset_id"] = "A_CUSTOM_MAP"
    root["asset_version"] = SPEC["version"]
    root["interactive_regions"] = len(REGIONS)
    root["units"] = "meters"
    bpy.context.scene.collection.objects.link(root)
    return root


def vertex_color_node(nodes: bpy.types.Nodes) -> bpy.types.Node:
    node = nodes.new("ShaderNodeVertexColor")
    node.layer_name = "COLOR_0"
    node.name = "COLOR_0"
    return node


def create_simple_material(name: str, base_color: tuple[float, float, float, float]) -> bpy.types.Material:
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.inputs["Roughness"].default_value = 0.50
    principled.inputs["Metallic"].default_value = 0.12
    rgb = nodes.new("ShaderNodeRGB")
    rgb.outputs[0].default_value = base_color
    vcolor = vertex_color_node(nodes)
    multiply = nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs[0].default_value = 1.0
    links.new(rgb.outputs[0], multiply.inputs[1])
    links.new(vcolor.outputs["Color"], multiply.inputs[2])
    links.new(multiply.outputs[0], principled.inputs["Base Color"])
    links.new(principled.outputs[0], output.inputs[0])
    return material


def load_image(path: Path, non_color: bool = False) -> bpy.types.Image:
    image = bpy.data.images.load(str(path), check_existing=True)
    if non_color:
        try:
            image.colorspace_settings.name = "Non-Color"
        except Exception:
            pass
    return image


def create_gltf_occlusion_group() -> bpy.types.NodeTree:
    group = bpy.data.node_groups.get("glTF Material Output")
    if group is not None:
        return group
    group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    output = group.nodes.new("NodeGroupOutput")
    output.name = "Group Output"
    return group


def create_pbr_material() -> bpy.types.Material:
    name = "MAT__MAP_PBR"
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.inputs["Roughness"].default_value = SPEC["materials"]["top_roughness"]
    principled.inputs["Metallic"].default_value = SPEC["materials"]["top_metallic"]

    base = nodes.new("ShaderNodeTexImage")
    base.name = "TEX__BASE_COLOR"
    base.image = load_image(TEXTURE_DIR / "Map_BaseColor.png", non_color=False)
    links.new(base.outputs["Color"], principled.inputs["Base Color"])

    orm_path = TEXTURE_DIR / "Map_ORM.png"
    if not orm_path.exists():
        orm_path = TEXTURE_DIR / "Map_ORM_Source.png"
    orm_texture = nodes.new("ShaderNodeTexImage")
    orm_texture.name = "TEX__ORM"
    orm_texture.image = load_image(orm_path, non_color=True)
    separate = nodes.new("ShaderNodeSeparateColor")
    separate.name = "SEPARATE__ORM"
    links.new(orm_texture.outputs["Color"], separate.inputs["Color"])
    links.new(separate.outputs["Green"], principled.inputs["Roughness"])
    links.new(separate.outputs["Blue"], principled.inputs["Metallic"])

    normal_path = TEXTURE_DIR / "Map_Normal.png"
    if not normal_path.exists():
        normal_path = TEXTURE_DIR / "Map_Normal_Source.png"
    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.name = "TEX__NORMAL"
    normal_texture.image = load_image(normal_path, non_color=True)
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.inputs["Strength"].default_value = 0.75
    links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])

    group_node = nodes.new("ShaderNodeGroup")
    group_node.name = "glTF Material Output"
    group_node.node_tree = create_gltf_occlusion_group()
    links.new(separate.outputs["Red"], group_node.inputs["Occlusion"])

    emission_input = principled.inputs.get("Emission Color") or principled.inputs.get("Emission")
    if emission_input is not None:
        links.new(base.outputs["Color"], emission_input)
        strength = principled.inputs.get("Emission Strength")
        if strength is not None:
            strength.default_value = 0.18
    links.new(principled.outputs[0], output.inputs[0])
    return material


def triangulate_indices(polygon: list[list[float]]) -> list[tuple[int, int, int]]:
    vectors = [Vector((float(x), float(y), 0.0)) for x, y in polygon]
    triangles = tessellate_polygon([vectors])
    index_by_coord = {(round(v.x, 7), round(v.y, 7)): i for i, v in enumerate(vectors)}
    output = []
    for tri in triangles:
        if tri and isinstance(tri[0], int):
            output.append(tuple(int(index) for index in tri))
        else:
            output.append(
                tuple(index_by_coord[(round(v.x, 7), round(v.y, 7))] for v in tri)
            )
    return output


def make_prism_mesh(
    region: dict,
    material: bpy.types.Material,
    add_uv: bool,
    bevel_width: float,
    bevel_segments: int,
) -> bpy.types.Object:
    polygon = region["polygon"]
    cx, cy = region["centroid"]
    count = len(polygon)
    local_xy = [(x - cx, y - cy) for x, y in polygon]
    vertices = [(x, y, DEPTH) for x, y in local_xy] + [(x, y, 0.0) for x, y in local_xy]
    top_tris = triangulate_indices(polygon)
    faces: list[tuple[int, ...]] = []
    faces.extend(top_tris)
    faces.extend(tuple(count + index for index in reversed(tri)) for tri in top_tris)
    for i in range(count):
        j = (i + 1) % count
        faces.append((i, j, count + j, count + i))

    mesh = bpy.data.meshes.new(f"MESH__REGION_{region['id']}")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(f"PART__REGION_{region['id']}", mesh)
    obj.location = (cx, cy, 0.0)
    obj.data.materials.append(material)
    obj["part_type"] = "region"
    obj["region_id"] = region["id"]
    obj["display_name"] = region["name"]
    obj["data_value"] = int(region["value"])
    obj["interactive"] = True
    obj["hotspot"] = f"HOTSPOT__REGION_{region['id']}"

    color = mesh.color_attributes.new(name="COLOR_0", type="BYTE_COLOR", domain="CORNER")
    top_face_count = len(top_tris)
    for poly in mesh.polygons:
        rgba = (1.0, 1.0, 1.0, 1.0) if poly.index < top_face_count else (0.10, 0.36, 0.40, 1.0)
        for loop_index in poly.loop_indices:
            color.data[loop_index].color = rgba

    if add_uv:
        min_x, min_y, max_x, max_y = GLOBAL_BOUNDS
        uv = mesh.uv_layers.new(name="UVMap")
        for poly in mesh.polygons:
            for loop_index in poly.loop_indices:
                vertex_index = mesh.loops[loop_index].vertex_index
                local_x, local_y, _ = mesh.vertices[vertex_index].co
                world_x = local_x + cx
                world_y = local_y + cy
                if poly.index < top_face_count:
                    uv.data[loop_index].uv = (
                        0.08 + 0.84 * (world_x - min_x) / (max_x - min_x),
                        0.08 + 0.84 * (world_y - min_y) / (max_y - min_y),
                    )
                else:
                    uv.data[loop_index].uv = (0.02, 0.02)

    if bevel_width > 0:
        bevel = obj.modifiers.new("BEVEL__EDGE_SOFTEN", "BEVEL")
        bevel.width = bevel_width
        bevel.segments = bevel_segments
        bevel.limit_method = "ANGLE"
        bevel.angle_limit = math.radians(25.0)
        bevel.harden_normals = True
    return obj


def create_region_stage(
    regions: list[dict],
    bevel_width: float,
    bevel_segments: int,
    add_uv: bool,
    exploded: bool = False,
    use_pbr: bool = False,
) -> tuple[bpy.types.Object, list[bpy.types.Object]]:
    root = create_root()
    collection = get_or_create_collection("COLL__MAP_REGIONS")
    material = create_pbr_material() if use_pbr else create_simple_material(
        "MAT__MAP_BLOCKOUT", tuple(SPEC["materials"]["top_base_color"])
    )
    objects = []
    for index, region in enumerate(regions):
        obj = make_prism_mesh(region, material, add_uv, bevel_width, bevel_segments)
        link_only(obj, collection)
        obj.parent = root
        if exploded:
            cx, cy = region["centroid"]
            obj.location.x += cx * 0.055
            obj.location.y += cy * 0.055
            obj.location.z = 0.10 + (index % 4) * 0.12
        objects.append(obj)
    return root, objects


def add_hotspots(root: bpy.types.Object, regions: list[dict]) -> list[bpy.types.Object]:
    collection = get_or_create_collection("COLL__HOTSPOTS")
    hotspots = []
    for region in regions:
        cx, cy = region["centroid"]
        hotspot = bpy.data.objects.new(f"HOTSPOT__REGION_{region['id']}", None)
        hotspot.empty_display_type = "SPHERE"
        hotspot.empty_display_size = 0.10
        hotspot.location = (cx, cy, DEPTH + 0.22)
        hotspot.parent = root
        hotspot["target"] = f"PART__REGION_{region['id']}"
        hotspot["region_id"] = region["id"]
        hotspot["display_name"] = region["name"]
        hotspot["data_value"] = int(region["value"])
        collection.objects.link(hotspot)
        hotspots.append(hotspot)
    return hotspots


def append_box(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    center_a: tuple[float, float],
    center_b: tuple[float, float],
    width: float,
    z0: float,
    z1: float,
) -> None:
    ax, ay = center_a
    bx, by = center_b
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy)
    if length < 1e-8:
        return
    nx, ny = -dy / length * width * 0.5, dx / length * width * 0.5
    base = len(vertices)
    vertices.extend(
        [
            (ax + nx, ay + ny, z0), (ax - nx, ay - ny, z0),
            (bx - nx, by - ny, z0), (bx + nx, by + ny, z0),
            (ax + nx, ay + ny, z1), (ax - nx, ay - ny, z1),
            (bx - nx, by - ny, z1), (bx + nx, by + ny, z1),
        ]
    )
    faces.extend(
        [
            (base, base + 1, base + 2, base + 3),
            (base + 4, base + 7, base + 6, base + 5),
            (base, base + 4, base + 5, base + 1),
            (base + 1, base + 5, base + 6, base + 2),
            (base + 2, base + 6, base + 7, base + 3),
            (base + 3, base + 7, base + 4, base),
        ]
    )


def append_bump(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    x: float,
    y: float,
    radius: float = 0.024,
    height: float = 0.022,
    segments: int = 8,
) -> None:
    base = len(vertices)
    vertices.append((x, y, DEPTH + height))
    for i in range(segments):
        angle = 2.0 * math.pi * i / segments
        vertices.append((x + math.cos(angle) * radius, y + math.sin(angle) * radius, DEPTH + 0.004))
    for i in range(segments):
        faces.append((base, base + 1 + i, base + 1 + ((i + 1) % segments)))


def create_high_detail_object(regions: list[dict], include_top: bool = False) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    if include_top:
        for region in regions:
            polygon = region["polygon"]
            base = len(vertices)
            vertices.extend((x, y, DEPTH + 0.003) for x, y in polygon)
            faces.extend(tuple(base + i for i in tri) for tri in triangulate_indices(polygon))

    for region in regions:
        polygon = region["polygon"]
        for i, start in enumerate(polygon):
            end = polygon[(i + 1) % len(polygon)]
            append_box(vertices, faces, start, end, 0.024, DEPTH + 0.004, DEPTH + 0.028)

    min_x, min_y, max_x, max_y = GLOBAL_BOUNDS
    spacing = 0.34
    y = min_y + spacing * 0.5
    while y < max_y:
        x = min_x + spacing * 0.5
        while x < max_x:
            if any(point_in_polygon((x, y), region["polygon"]) for region in regions):
                append_bump(vertices, faces, x, y)
            x += spacing
        y += spacing

    mesh = bpy.data.meshes.new("MESH__HIGH_DETAIL")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("HIGH__BOUNDARY_AND_DOTS", mesh)
    material = create_simple_material("MAT__HIGH_DETAIL", (0.08, 0.95, 0.88, 1.0))
    obj.data.materials.append(material)
    get_or_create_collection("COLL__HIGH_DETAIL").objects.link(obj)
    return obj


def create_bake_target(regions: list[dict]) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    region_offsets = []
    for region in regions:
        polygon = region["polygon"]
        base = len(vertices)
        vertices.extend((x, y, DEPTH) for x, y in polygon)
        tris = triangulate_indices(polygon)
        start_face = len(faces)
        faces.extend(tuple(base + i for i in tri) for tri in tris)
        region_offsets.append((start_face, len(faces), region))
    mesh = bpy.data.meshes.new("MESH__BAKE_TARGET")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("BAKE_TARGET__MAP_TOP", mesh)
    get_or_create_collection("COLL__BAKE").objects.link(obj)
    min_x, min_y, max_x, max_y = GLOBAL_BOUNDS
    uv = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            x, y, _ = mesh.vertices[vertex_index].co
            uv.data[loop_index].uv = (
                0.08 + 0.84 * (x - min_x) / (max_x - min_x),
                0.08 + 0.84 * (y - min_y) / (max_y - min_y),
            )
    return obj


def create_bake_material(image: bpy.types.Image) -> bpy.types.Material:
    material = bpy.data.materials.get("MAT__BAKE_TARGET") or bpy.data.materials.new("MAT__BAKE_TARGET")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    image_node = nodes.new("ShaderNodeTexImage")
    image_node.name = "BAKE_IMAGE_TARGET"
    image_node.image = image
    nodes.active = image_node
    material.node_tree.links.new(principled.outputs[0], output.inputs[0])
    return material


def bake_map(high: bpy.types.Object, target: bpy.types.Object, kind: str, path: Path) -> bpy.types.Image:
    size = int(SPEC["texture_size"])
    image = bpy.data.images.new(
        name=f"Map_{kind}", width=size, height=size, alpha=False, float_buffer=False
    )
    image.generated_color = (0.5, 0.5, 1.0, 1.0) if kind == "Normal" else (1.0, 1.0, 1.0, 1.0)
    try:
        image.colorspace_settings.name = "Non-Color"
    except Exception:
        pass
    target.data.materials.clear()
    target.data.materials.append(create_bake_material(image))
    bpy.ops.object.select_all(action="DESELECT")
    high.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.samples = 16
    bpy.context.scene.cycles.use_denoising = False
    bake_type = "NORMAL" if kind == "Normal" else "AO"
    bpy.ops.object.bake(
        type=bake_type,
        margin=12,
        use_selected_to_active=True,
        max_ray_distance=0.12,
        cage_extrusion=0.04,
        normal_space="TANGENT",
        target="IMAGE_TEXTURES",
        use_clear=True,
    )
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    return image


def combine_orm(ao: bpy.types.Image) -> bpy.types.Image:
    rough = load_image(TEXTURE_DIR / "Map_Roughness.png", non_color=True)
    metal = load_image(TEXTURE_DIR / "Map_Metallic.png", non_color=True)
    size = int(SPEC["texture_size"])
    count = size * size * 4
    ao_pixels = array("f", [0.0]) * count
    rough_pixels = array("f", [0.0]) * count
    metal_pixels = array("f", [0.0]) * count
    ao.pixels.foreach_get(ao_pixels)
    rough.pixels.foreach_get(rough_pixels)
    metal.pixels.foreach_get(metal_pixels)
    orm_pixels = array("f", [0.0]) * count
    for i in range(0, count, 4):
        orm_pixels[i] = ao_pixels[i]
        orm_pixels[i + 1] = rough_pixels[i]
        orm_pixels[i + 2] = metal_pixels[i]
        orm_pixels[i + 3] = 1.0
    orm = bpy.data.images.new("Map_ORM", width=size, height=size, alpha=False)
    orm.pixels.foreach_set(orm_pixels)
    orm.filepath_raw = str(TEXTURE_DIR / "Map_ORM.png")
    orm.file_format = "PNG"
    orm.save()
    return orm


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_preview(stage: str) -> None:
    camera_data = bpy.data.cameras.new("Camera__Preview")
    camera = bpy.data.objects.new("Camera__Preview", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera.location = (0.0, -11.8, 9.2)
    camera_data.lens = 52
    look_at(camera, Vector((0.0, 0.0, 0.20)))
    bpy.context.scene.camera = camera

    key_data = bpy.data.lights.new("Light__Key", type="AREA")
    key_data.energy = 1050
    key_data.shape = "DISK"
    key_data.size = 7.0
    key = bpy.data.objects.new("Light__Key", key_data)
    key.location = (-4.0, -5.0, 8.0)
    look_at(key, Vector((0.0, 0.0, 0.0)))
    bpy.context.scene.collection.objects.link(key)

    fill_data = bpy.data.lights.new("Light__Fill", type="AREA")
    fill_data.energy = 650
    fill_data.size = 6.0
    fill = bpy.data.objects.new("Light__Fill", fill_data)
    fill.location = (5.0, 2.5, 5.0)
    look_at(fill, Vector((0.0, 0.0, 0.0)))
    bpy.context.scene.collection.objects.link(fill)

    bpy.context.scene.render.filepath = str(RENDER_DIR / f"{stage}.png")


def save_and_render(stage: str) -> None:
    setup_preview(stage)
    filepath = BLEND_DIR / f"{stage}.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(filepath), check_existing=False)
    bpy.ops.render.render(write_still=True)


def evaluated_metrics(objects: list[bpy.types.Object]) -> dict:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    vertices = 0
    triangles = 0
    primitives = 0
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        vertices += len(mesh.vertices)
        triangles += len(mesh.loop_triangles)
        primitives += max(1, len(mesh.materials))
        evaluated.to_mesh_clear()
    return {
        "mesh_objects": len(objects),
        "vertices": vertices,
        "triangles": triangles,
        "estimated_draw_calls": primitives,
    }


def export_glb(objects: list[bpy.types.Object]) -> Path:
    raw_path = EXPORT_DIR / "A_custom_map_low_raw.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(raw_path),
        export_format="GLB",
        export_texcoords=True,
        export_normals=True,
        export_tangents=True,
        export_materials="EXPORT",
        export_unused_images=False,
        export_cameras=False,
        export_lights=False,
        use_selection=False,
        use_visible=True,
        export_extras=True,
        export_yup=True,
        export_apply=True,
        export_animations=False,
        export_frame_range=False,
        export_attributes=True,
        export_vertex_color="NONE",
    )
    return raw_path


def main() -> None:
    started = time.perf_counter()
    stages = []

    clear_scene()
    create_region_stage(REGIONS_WITH_GAP, 0.0, 1, add_uv=False, exploded=True)
    save_and_render("A01_structure_breakdown")
    stages.append("A01_structure_breakdown")

    clear_scene()
    create_region_stage(REGIONS, 0.0, 1, add_uv=False)
    save_and_render("A02_base_shape")
    stages.append("A02_base_shape")

    clear_scene()
    create_region_stage(
        REGIONS_WITH_GAP,
        float(SPEC["dimensions"]["refined_bevel"]),
        2,
        add_uv=False,
    )
    save_and_render("A03_shape_refined")
    stages.append("A03_shape_refined")

    clear_scene()
    create_region_stage(
        REGIONS_WITH_GAP,
        float(SPEC["dimensions"]["high_bevel"]),
        4,
        add_uv=False,
    )
    create_high_detail_object(REGIONS_WITH_GAP, include_top=False)
    save_and_render("A04_highpoly_detail")
    stages.append("A04_highpoly_detail")

    clear_scene()
    _, low_objects = create_region_stage(
        REGIONS_WITH_GAP,
        float(SPEC["dimensions"]["low_bevel"]),
        1,
        add_uv=False,
    )
    low_metrics = evaluated_metrics(low_objects)
    save_and_render("A05_lowpoly_retopology")
    stages.append("A05_lowpoly_retopology")

    clear_scene()
    _, uv_objects = create_region_stage(
        REGIONS_WITH_GAP,
        float(SPEC["dimensions"]["low_bevel"]),
        1,
        add_uv=True,
        use_pbr=True,
    )
    save_and_render("A06_uv_unwrapped")
    stages.append("A06_uv_unwrapped")

    high = create_high_detail_object(REGIONS_WITH_GAP, include_top=True)
    target = create_bake_target(REGIONS_WITH_GAP)
    high_name = high.name
    target_name = target.name
    normal = bake_map(high, target, "Normal", TEXTURE_DIR / "Map_Normal.png")
    ao = bake_map(high, target, "AO", TEXTURE_DIR / "Map_AO.png")
    combine_orm(ao)
    bpy.data.objects.remove(high, do_unlink=True)
    bpy.data.objects.remove(target, do_unlink=True)
    for obj in uv_objects:
        obj.data.materials.clear()
        obj.data.materials.append(create_pbr_material())
    save_and_render("A07_baked_pbr")
    stages.append("A07_baked_pbr")

    root = bpy.data.objects.get("A_CUSTOM_MAP_ROOT")
    hotspots = add_hotspots(root, REGIONS_WITH_GAP)
    root["triangle_budget"] = int(SPEC["performance"]["triangle_budget"])
    root["texture_size"] = int(SPEC["texture_size"])
    root["pipeline_stage"] = "export_ready"
    save_and_render("A08_export_ready")
    stages.append("A08_export_ready")
    raw_glb = export_glb(uv_objects)

    final_metrics = evaluated_metrics(uv_objects)
    report = {
        "asset": SPEC["asset"],
        "blender": bpy.app.version_string,
        "stages": stages,
        "regions": len(uv_objects),
        "hotspots": len(hotspots),
        "lowpoly": low_metrics,
        "final": final_metrics,
        "budgets": SPEC["performance"],
        "raw_glb": str(raw_glb),
        "raw_glb_bytes": raw_glb.stat().st_size,
        "baked_textures": [
            "Map_BaseColor.png", "Map_Normal.png", "Map_AO.png",
            "Map_Roughness.png", "Map_Metallic.png", "Map_ORM.png"
        ],
        "duration_seconds": round(time.perf_counter() - started, 3),
    }
    (REPORT_DIR / "blender_pipeline_metrics.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (REPORT_DIR / "bake_manifest.json").write_text(
        json.dumps(
            {
                "normal": {"method": "selected-to-active", "source": high_name, "target": target_name, "size": SPEC["texture_size"]},
                "ao": {"method": "selected-to-active", "source": high_name, "target": target_name, "size": SPEC["texture_size"]},
                "uv_layer": "UVMap",
                "margin_pixels": 12,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print("PIPELINE_REPORT=" + json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
