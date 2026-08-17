#!/usr/bin/env python3
"""Author the shared PBR texture set for the precision-traced map."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
GEOMETRY_PATH = ROOT / "source/generated/reference_geometry.json"
TEXTURE_DIR = ROOT / "textures/png"
REPORT_DIR = ROOT / "reports"
SIZE = 1024
UV_MIN = 0.08
UV_MAX = 0.92


def scalar_field(base: float, amount: float, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    noise = (
        np.sin(x * 0.031 + y * 0.013)
        + 0.55 * np.sin(x * 0.087 - y * 0.041)
        + 0.24 * np.cos(x * 0.173 + y * 0.109)
    )
    return np.clip(base + amount * noise, 0, 255)


def main() -> None:
    TEXTURE_DIR.mkdir(parents=True, exist_ok=True)
    geometry = json.loads(GEOMETRY_PATH.read_text(encoding="utf-8"))
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    u = xx / (SIZE - 1)
    v = yy / (SIZE - 1)

    # Reference uses a restrained turquoise body: brighter on top, dark cyan on the wall.
    micro = scalar_field(0, 1.0, xx, yy)
    micro = (micro - 127.5) / 127.5
    radial = np.clip(1.0 - np.hypot(u - 0.48, v - 0.58) * 0.8, 0, 1)
    base = np.empty((SIZE, SIZE, 3), dtype=np.float32)
    base[..., 0] = 22 + 10 * radial + 1.5 * micro
    base[..., 1] = 139 + 32 * radial + 3.0 * micro
    base[..., 2] = 134 + 31 * radial + 3.0 * micro

    strip_rows = int(SIZE * 0.065)
    stripe = (
        0.72
        + 0.17 * np.sin(np.arange(SIZE) * 0.19)
        + 0.10 * np.sin(np.arange(SIZE) * 0.53 + 0.8)
        + 0.05 * np.cos(np.arange(SIZE) * 1.27)
    )
    side = np.stack([7 + 6 * stripe, 61 + 36 * stripe, 66 + 39 * stripe], axis=-1)
    side_band = np.repeat(side[np.newaxis, :, :], strip_rows, axis=0)
    base[:strip_rows, :, :] = side_band
    base[-strip_rows:, :, :] = side_band
    Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB").save(
        TEXTURE_DIR / "Map_BaseColor.png", optimize=True
    )

    roughness = scalar_field(106, 5.0, xx, yy).astype(np.uint8)
    metallic = scalar_field(42, 2.4, xx, yy).astype(np.uint8)
    ao = scalar_field(246, 2.0, xx, yy).astype(np.uint8)
    side_ao = np.clip(207 + stripe * 20, 0, 255).astype(np.uint8)
    roughness[:strip_rows] = roughness[-strip_rows:] = 145
    metallic[:strip_rows] = metallic[-strip_rows:] = 24
    ao[:strip_rows] = ao[-strip_rows:] = side_ao
    Image.fromarray(roughness, "L").save(TEXTURE_DIR / "Map_Roughness.png", optimize=True)
    Image.fromarray(metallic, "L").save(TEXTURE_DIR / "Map_Metallic.png", optimize=True)
    Image.fromarray(ao, "L").save(TEXTURE_DIR / "Map_AO_Source.png", optimize=True)

    normal = np.zeros((SIZE, SIZE, 3), dtype=np.uint8)
    normal[..., 0] = 128
    normal[..., 1] = 128
    normal[..., 2] = 255
    Image.fromarray(normal, "RGB").save(TEXTURE_DIR / "Map_Normal_Source.png", optimize=True)
    Image.fromarray(np.dstack([ao, roughness, metallic]), "RGB").save(
        TEXTURE_DIR / "Map_ORM_Source.png", optimize=True
    )

    outline = geometry["outline"]["high"]
    min_x = min(point[0] for point in outline)
    max_x = max(point[0] for point in outline)
    min_y = min(point[1] for point in outline)
    max_y = max(point[1] for point in outline)
    uv_image = Image.new("RGB", (SIZE, SIZE), (4, 12, 14))
    draw = ImageDraw.Draw(uv_image)
    for region in geometry["regions"]:
        points = []
        for x, y in region["low_gap"]:
            uu = UV_MIN + (UV_MAX - UV_MIN) * (x - min_x) / (max_x - min_x)
            vv = UV_MIN + (UV_MAX - UV_MIN) * (y - min_y) / (max_y - min_y)
            points.append((int(uu * SIZE), int((1.0 - vv) * SIZE)))
        draw.line(points + [points[0]], fill=(95, 255, 245), width=2)
        cx, cy = region["centroid"]
        uu = UV_MIN + (UV_MAX - UV_MIN) * (cx - min_x) / (max_x - min_x)
        vv = UV_MIN + (UV_MAX - UV_MIN) * (cy - min_y) / (max_y - min_y)
        draw.text((int(uu * SIZE), int((1.0 - vv) * SIZE)), region["id"], fill=(225, 255, 253))
    uv_image.save(TEXTURE_DIR / "Map_UV_Layout.png", optimize=True)

    report = {
        "size": SIZE,
        "uv_safe_area": [UV_MIN, UV_MAX],
        "side_strip_rows": strip_rows,
        "textures": [
            "Map_BaseColor.png", "Map_Roughness.png", "Map_Metallic.png",
            "Map_AO_Source.png", "Map_Normal_Source.png", "Map_ORM_Source.png",
            "Map_UV_Layout.png",
        ],
    }
    (REPORT_DIR / "texture_generation.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
