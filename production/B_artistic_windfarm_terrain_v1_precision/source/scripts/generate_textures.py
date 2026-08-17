#!/usr/bin/env python3
"""Author terrain PBR source textures from the deterministic high-resolution heightfield."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "source"
GENERATED = SOURCE / "generated"
TEXTURES = ROOT / "textures/png"
REPORTS = ROOT / "reports"
SPEC = json.loads((SOURCE / "terrain_spec.json").read_text(encoding="utf-8"))
SIZE = int(SPEC["texture_size"])


def smoothstep(edge0: float, edge1: float, value: np.ndarray) -> np.ndarray:
    result = np.clip((value - edge0) / max(edge1 - edge0, 1e-8), 0.0, 1.0)
    return result * result * (3.0 - 2.0 * result)


def main() -> None:
    TEXTURES.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    fields = np.load(GENERATED / "terrain_fields.npz")
    master = fields["master"].astype(np.float32)
    height = cv2.resize(master, (SIZE, SIZE), interpolation=cv2.INTER_CUBIC)
    height = cv2.GaussianBlur(height, (0, 0), 0.48)
    relief = float(SPEC["dimensions"]["terrain_relief_m"])
    normalized = np.clip(height / relief, 0.0, 1.0)

    # Physical gradients account for the rectangular 14:9 terrain footprint.
    dz_dy, dz_dx = np.gradient(height)
    dz_dx *= SIZE / float(SPEC["dimensions"]["width_m"])
    dz_dy *= SIZE / float(SPEC["dimensions"]["depth_m"])
    slope = np.clip(np.hypot(dz_dx, dz_dy) / 4.5, 0.0, 1.0)

    rng = np.random.default_rng(3319)
    fine = rng.random((129, 129), dtype=np.float32)
    fine = cv2.resize(fine, (SIZE, SIZE), interpolation=cv2.INTER_CUBIC)
    broad = cv2.GaussianBlur(fine, (0, 0), 15.0)
    texture_noise = np.clip((fine - 0.5) * 0.32 + (broad - 0.5) * 0.65, -0.25, 0.25)

    rock = np.clip(smoothstep(0.16, 0.50, slope) * 0.92 + smoothstep(0.48, 0.82, normalized) * 0.62, 0.0, 1.0)
    local = cv2.GaussianBlur(normalized, (0, 0), 7.5)
    striation = smoothstep(0.015, 0.095, np.abs(normalized - local))
    rock = np.clip(rock + texture_noise * 0.26 + striation * slope * 0.38, 0.0, 1.0)
    valley = 1.0 - smoothstep(0.12, 0.50, normalized)
    grass_light = np.clip(0.55 + texture_noise * 0.9 + normalized * 0.15, 0.0, 1.0)

    grass_dark = np.array([43.0, 76.0, 36.0], dtype=np.float32)
    grass_bright = np.array([118.0, 151.0, 70.0], dtype=np.float32)
    rock_dark = np.array([75.0, 79.0, 68.0], dtype=np.float32)
    rock_light = np.array([186.0, 187.0, 168.0], dtype=np.float32)
    grass = grass_dark + (grass_bright - grass_dark) * grass_light[..., None]
    rock_color = rock_dark + (rock_light - rock_dark) * np.clip(normalized * 0.72 + slope * 0.35, 0, 1)[..., None]
    color = grass * (1.0 - rock[..., None]) + rock_color * rock[..., None]
    color *= (0.94 + 0.06 * (1.0 - valley))[..., None]
    color = np.clip(color, 0, 255).astype(np.uint8)
    Image.fromarray(color, "RGB").save(TEXTURES / "Terrain_BaseColor.png", optimize=True)

    # Tangent-space normal source; Blender later replaces it with selected-to-active bake output.
    nx = -dz_dx * 0.64
    ny = dz_dy * 0.64
    nz = np.ones_like(nx)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.dstack([
        (nx / length * 0.5 + 0.5) * 255.0,
        (ny / length * 0.5 + 0.5) * 255.0,
        (nz / length * 0.5 + 0.5) * 255.0,
    ]).astype(np.uint8)
    Image.fromarray(normal, "RGB").save(TEXTURES / "Terrain_Normal_Source.png", optimize=True)

    local_mean = cv2.GaussianBlur(height, (0, 0), 18.0)
    cavity = np.clip((local_mean - height) / 0.42, 0.0, 1.0)
    ao = np.clip(1.0 - cavity * 0.38 - valley * 0.06, 0.48, 1.0)
    roughness = np.clip(0.66 + rock * 0.18 + texture_noise * 0.05, 0.55, 0.92)
    metallic = np.zeros_like(roughness) + 0.015
    Image.fromarray(np.round(ao * 255).astype(np.uint8), "L").save(TEXTURES / "Terrain_AO_Source.png", optimize=True)
    Image.fromarray(np.round(roughness * 255).astype(np.uint8), "L").save(TEXTURES / "Terrain_Roughness.png", optimize=True)
    Image.fromarray(np.round(metallic * 255).astype(np.uint8), "L").save(TEXTURES / "Terrain_Metallic.png", optimize=True)
    orm = np.dstack([ao, roughness, metallic])
    Image.fromarray(np.round(orm * 255).astype(np.uint8), "RGB").save(TEXTURES / "Terrain_ORM_Source.png", optimize=True)

    # UV inspection plate: 16×16 checker with a cyan border.
    checker = np.zeros((SIZE, SIZE, 3), dtype=np.uint8)
    cells = 16
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    pattern = ((xx // (SIZE // cells)) + (yy // (SIZE // cells))) % 2
    checker[pattern == 0] = (12, 61, 58)
    checker[pattern == 1] = (45, 131, 116)
    checker[:5] = checker[-5:] = checker[:, :5] = checker[:, -5:] = (86, 255, 239)
    Image.fromarray(checker, "RGB").save(TEXTURES / "Terrain_UV_Checker.png", optimize=True)

    report = {
        "texture_size": SIZE,
        "base_color": "Terrain_BaseColor.png",
        "normal_source": "Terrain_Normal_Source.png",
        "ao_source": "Terrain_AO_Source.png",
        "roughness": "Terrain_Roughness.png",
        "metallic": "Terrain_Metallic.png",
        "orm_source": "Terrain_ORM_Source.png",
        "uv_checker": "Terrain_UV_Checker.png",
        "rock_coverage": round(float(np.mean(rock > 0.5)), 5),
    }
    (REPORTS / "texture_generation.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
