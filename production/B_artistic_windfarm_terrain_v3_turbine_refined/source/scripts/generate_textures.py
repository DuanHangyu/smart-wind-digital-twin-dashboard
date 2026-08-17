#!/usr/bin/env python3
"""Create PBR textures from the rectified reference material and height panels."""

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
    result = np.clip((value - edge0) / max(edge1 - edge0, 1e-8), 0, 1)
    return result * result * (3 - 2 * result)


def main() -> None:
    TEXTURES.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    fields = np.load(GENERATED / "terrain_fields.npz")
    master = fields["master"].astype(np.float32)
    material_bgr = cv2.imread(str(GENERATED / "Reference_BaseColor_Rectified.png"), cv2.IMREAD_COLOR)
    if material_bgr is None:
        raise FileNotFoundError("Run generate_terrain_data.py first")
    base_rgb = cv2.cvtColor(cv2.resize(material_bgr, (SIZE, SIZE), interpolation=cv2.INTER_LANCZOS4), cv2.COLOR_BGR2RGB)
    # Keep reference coloration; only remove a small amount of baked grey haze.
    lab = cv2.cvtColor(base_rgb, cv2.COLOR_RGB2LAB)
    lab[..., 0] = cv2.createCLAHE(clipLimit=1.28, tileGridSize=(8, 8)).apply(lab[..., 0])
    base_rgb = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)
    Image.fromarray(base_rgb, "RGB").save(TEXTURES / "Terrain_BaseColor.png", optimize=True)

    height = cv2.resize(master, (SIZE, SIZE), interpolation=cv2.INTER_CUBIC)
    relief = float(SPEC["dimensions"]["terrain_relief_m"])
    normalized = np.clip(height / relief, 0, 1)
    dz_dy, dz_dx = np.gradient(height)
    dz_dx *= SIZE / float(SPEC["dimensions"]["width_m"])
    dz_dy *= SIZE / float(SPEC["dimensions"]["depth_m"])
    slope = np.clip(np.hypot(dz_dx, dz_dy) / 5.0, 0, 1)

    nx, ny = -dz_dx * 0.76, dz_dy * 0.76
    nz = np.ones_like(nx)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.dstack([(nx / length * .5 + .5), (ny / length * .5 + .5), (nz / length * .5 + .5)])
    Image.fromarray(np.uint8(np.clip(normal, 0, 1) * 255), "RGB").save(TEXTURES / "Terrain_Normal_Source.png", optimize=True)

    local = cv2.GaussianBlur(height, (0, 0), 17.0)
    cavity = np.clip((local - height) / .33, 0, 1)
    ao = np.clip(1 - cavity * .42, .48, 1)
    rock = np.clip(smoothstep(.18, .58, slope) * .82 + smoothstep(.62, .90, normalized) * .38, 0, 1)
    roughness = np.clip(.64 + rock * .20 + cavity * .05, .58, .92)
    metallic = np.full_like(roughness, .01)
    Image.fromarray(np.uint8(ao * 255), "L").save(TEXTURES / "Terrain_AO_Source.png", optimize=True)
    Image.fromarray(np.uint8(roughness * 255), "L").save(TEXTURES / "Terrain_Roughness.png", optimize=True)
    Image.fromarray(np.uint8(metallic * 255), "L").save(TEXTURES / "Terrain_Metallic.png", optimize=True)
    Image.fromarray(np.uint8(np.dstack([ao, roughness, metallic]) * 255), "RGB").save(TEXTURES / "Terrain_ORM_Source.png", optimize=True)

    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    pattern = ((xx // 64) + (yy // 64)) % 2
    checker = np.where(pattern[..., None] == 0, np.array([12, 61, 58]), np.array([45, 131, 116])).astype(np.uint8)
    checker[:5] = checker[-5:] = checker[:, :5] = checker[:, -5:] = (86, 255, 239)
    Image.fromarray(checker, "RGB").save(TEXTURES / "Terrain_UV_Checker.png", optimize=True)

    # Source-color retention is measured before the small CLAHE contrast correction.
    source_rgb = cv2.cvtColor(cv2.resize(material_bgr, (SIZE, SIZE), interpolation=cv2.INTER_LANCZOS4), cv2.COLOR_BGR2RGB)
    color_mae = float(np.mean(np.abs(base_rgb.astype(np.float32) - source_rgb.astype(np.float32))) / 255.0)
    report = {"texture_size": SIZE, "source": "rectified material reference", "base_color_source_mae": round(color_mae, 6), "rock_coverage": round(float(np.mean(rock > .5)), 6)}
    (REPORTS / "texture_generation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
