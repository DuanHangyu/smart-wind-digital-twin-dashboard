#!/usr/bin/env python3
"""Generate deterministic vector sources and authored PBR texture inputs."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SCRIPT_DIR = Path(__file__).resolve().parent
ASSET_ROOT = SCRIPT_DIR.parents[1]
SOURCE_DIR = ASSET_ROOT / "source"
GENERATED_DIR = SOURCE_DIR / "generated"
TEXTURE_DIR = ASSET_ROOT / "textures" / "png"
sys.path.insert(0, str(SCRIPT_DIR))

from map_geometry import area, bounds, build_regions, load_spec  # noqa: E402


def write_region_sources(spec: dict) -> list[dict]:
    regions = build_regions(spec, gap=False)
    regions_with_gap = build_regions(spec, gap=True)
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)

    payload = {
        "asset": spec["asset"],
        "version": spec["version"],
        "regions": regions,
        "regions_with_gap": regions_with_gap,
        "area_sum": round(sum(r["area"] for r in regions), 6),
    }
    (GENERATED_DIR / "map_regions.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    min_x, min_y, max_x, max_y = bounds([r["polygon"] for r in regions])
    width = max_x - min_x
    height = max_y - min_y
    pad = 0.25
    paths = []
    for region in regions:
        points = region["polygon"]
        commands = [f"M {points[0][0]:.5f} {-points[0][1]:.5f}"]
        commands.extend(f"L {x:.5f} {-y:.5f}" for x, y in points[1:])
        commands.append("Z")
        paths.append(
            f'  <path id="Region_{region["id"]}" d="{" ".join(commands)}" '
            f'fill="#159b96" stroke="#69fff6" stroke-width="0.025"/>'
        )
    svg = "\n".join(
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{min_x-pad:.5f} {-max_y-pad:.5f} {width+2*pad:.5f} {height+2*pad:.5f}">',
            *paths,
            "</svg>",
        ]
    )
    (GENERATED_DIR / "map_outline.svg").write_text(svg, encoding="utf-8")
    return regions


def create_base_color(size: int) -> Image.Image:
    yy, xx = np.mgrid[0:size, 0:size]
    u = xx / max(1, size - 1)
    v = yy / max(1, size - 1)
    noise = (
        np.sin(xx * 0.041) * np.cos(yy * 0.037)
        + 0.5 * np.sin((xx + yy) * 0.071)
    )
    base = np.zeros((size, size, 3), dtype=np.float32)
    base[..., 0] = 14 + 16 * (1 - v) + 3 * noise
    base[..., 1] = 126 + 48 * (1 - v) + 5 * noise
    base[..., 2] = 121 + 44 * (1 - v) + 5 * noise

    spacing = max(12, size // 64)
    radius = max(1, size // 512)
    for y in range(spacing // 2, size, spacing):
        for x in range(spacing // 2, size, spacing):
            mask = (xx - x) ** 2 + (yy - y) ** 2 <= radius * radius
            base[mask, 0] += 16
            base[mask, 1] += 42
            base[mask, 2] += 40
    strip = max(8, int(size * 0.06))
    base[:strip, :, :] = np.array([4, 48, 55], dtype=np.float32)
    base[-strip:, :, :] = np.array([4, 48, 55], dtype=np.float32)
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB")


def create_scalar_texture(size: int, base_value: int, noise_amount: int) -> Image.Image:
    yy, xx = np.mgrid[0:size, 0:size]
    noise = np.sin(xx * 0.029 + yy * 0.017) + 0.5 * np.cos(xx * 0.063 - yy * 0.051)
    values = np.clip(base_value + noise_amount * noise, 0, 255).astype(np.uint8)
    return Image.fromarray(values, "L")


def create_flat_normal(size: int) -> Image.Image:
    normal = np.zeros((size, size, 3), dtype=np.uint8)
    normal[..., 0] = 128
    normal[..., 1] = 128
    normal[..., 2] = 255
    return Image.fromarray(normal, "RGB")


def create_uv_layout(size: int, regions: list[dict]) -> Image.Image:
    min_x, min_y, max_x, max_y = bounds([r["polygon"] for r in regions])
    image = Image.new("RGB", (size, size), (6, 17, 19))
    draw = ImageDraw.Draw(image)
    for region in regions:
        points = []
        for x, y in region["polygon"]:
            u = (x - min_x) / (max_x - min_x)
            v = (y - min_y) / (max_y - min_y)
            points.append((int(u * (size - 40) + 20), int((1 - v) * (size - 40) + 20)))
        draw.line(points + [points[0]], fill=(87, 255, 244), width=max(1, size // 512))
        cx, cy = region["centroid"]
        u = (cx - min_x) / (max_x - min_x)
        v = (cy - min_y) / (max_y - min_y)
        draw.text((int(u * (size - 40) + 20), int((1 - v) * (size - 40) + 20)), region["id"], fill=(220, 255, 252))
    return image


def write_textures(spec: dict, regions: list[dict]) -> None:
    size = int(spec["texture_size"])
    TEXTURE_DIR.mkdir(parents=True, exist_ok=True)
    create_base_color(size).save(TEXTURE_DIR / "Map_BaseColor.png", optimize=True)
    roughness = np.asarray(create_scalar_texture(size, 122, 10)).copy()
    metallic = np.asarray(create_scalar_texture(size, 31, 4)).copy()
    ao_source = np.asarray(create_scalar_texture(size, 242, 5)).copy()
    strip = max(8, int(size * 0.06))
    roughness[:strip, :] = roughness[-strip:, :] = 165
    metallic[:strip, :] = metallic[-strip:, :] = 48
    ao_source[:strip, :] = ao_source[-strip:, :] = 232
    Image.fromarray(roughness, "L").save(TEXTURE_DIR / "Map_Roughness.png", optimize=True)
    Image.fromarray(metallic, "L").save(TEXTURE_DIR / "Map_Metallic.png", optimize=True)
    Image.fromarray(ao_source, "L").save(TEXTURE_DIR / "Map_AO_Source.png", optimize=True)
    create_flat_normal(size).save(TEXTURE_DIR / "Map_Normal_Source.png", optimize=True)
    create_uv_layout(size, regions).save(TEXTURE_DIR / "Map_UV_Layout.png", optimize=True)

    rough = np.asarray(Image.open(TEXTURE_DIR / "Map_Roughness.png").convert("L"))
    metal = np.asarray(Image.open(TEXTURE_DIR / "Map_Metallic.png").convert("L"))
    ao = np.asarray(Image.open(TEXTURE_DIR / "Map_AO_Source.png").convert("L"))
    orm = np.dstack([ao, rough, metal]).astype(np.uint8)
    Image.fromarray(orm, "RGB").save(TEXTURE_DIR / "Map_ORM_Source.png", optimize=True)


def main() -> None:
    spec = load_spec(SOURCE_DIR / "map_spec.json")
    regions = write_region_sources(spec)
    write_textures(spec, regions)
    report = {
        "asset": spec["asset"],
        "regions": len(regions),
        "source_area": round(sum(r["area"] for r in regions), 6),
        "texture_size": spec["texture_size"],
        "outputs": [
            "source/generated/map_regions.json",
            "source/generated/map_outline.svg",
            "textures/png/Map_BaseColor.png",
            "textures/png/Map_Roughness.png",
            "textures/png/Map_Metallic.png",
            "textures/png/Map_AO_Source.png",
            "textures/png/Map_Normal_Source.png",
            "textures/png/Map_ORM_Source.png",
            "textures/png/Map_UV_Layout.png"
        ]
    }
    (GENERATED_DIR / "source_generation_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
