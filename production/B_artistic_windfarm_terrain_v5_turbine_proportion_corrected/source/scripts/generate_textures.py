#!/usr/bin/env python3
"""Create reference-driven, lighting-neutral PBR textures for the V4 terrain.

The source material panel contains useful erosion colour but also contains baked
lighting.  V4 separates the low-frequency illumination from the albedo and uses
only band-limited height residuals for the tangent-space detail normal.  The
macro mountain silhouette therefore remains the responsibility of geometry.
"""

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


def percentile_unit(value: np.ndarray, low: float = 1.0, high: float = 99.0) -> np.ndarray:
    lo, hi = np.percentile(value, [low, high])
    return np.clip((value - lo) / max(float(hi - lo), 1e-8), 0.0, 1.0)


def save_gray(path: Path, value: np.ndarray) -> None:
    Image.fromarray(np.uint8(np.clip(value, 0, 1) * 255), "L").save(path, optimize=True)


def labelled_panel(image: np.ndarray, title: str) -> np.ndarray:
    result = image.copy()
    cv2.rectangle(result, (0, 0), (result.shape[1], 38), (8, 12, 13), -1)
    cv2.putText(result, title, (13, 26), cv2.FONT_HERSHEY_SIMPLEX, .62, (238, 246, 244), 1, cv2.LINE_AA)
    return result


def main() -> None:
    TEXTURES.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    fields = np.load(GENERATED / "terrain_fields.npz")
    master = fields["master"].astype(np.float32)
    material_bgr = cv2.imread(str(GENERATED / "Reference_BaseColor_Rectified.png"), cv2.IMREAD_COLOR)
    if material_bgr is None:
        raise FileNotFoundError("Run generate_terrain_data.py first")
    source_rgb_u8 = cv2.cvtColor(
        cv2.resize(material_bgr, (SIZE, SIZE), interpolation=cv2.INTER_LANCZOS4),
        cv2.COLOR_BGR2RGB,
    )
    source_rgb = source_rgb_u8.astype(np.float32) / 255.0

    height = cv2.resize(master, (SIZE, SIZE), interpolation=cv2.INTER_CUBIC)
    relief = float(SPEC["dimensions"]["terrain_relief_m"])
    normalized = np.clip(height / relief, 0, 1)
    dz_dy, dz_dx = np.gradient(height)
    dz_dx *= SIZE / float(SPEC["dimensions"]["width_m"])
    dz_dy *= SIZE / float(SPEC["dimensions"]["depth_m"])
    gradient_magnitude = np.hypot(dz_dx, dz_dy)
    slope_degrees = np.degrees(np.arctan(gradient_magnitude))
    slope = smoothstep(24.0, 58.0, slope_degrees)

    # Reference-aware material masks.  High and steep low-saturation areas are
    # rock; low, gentle valleys can read slightly damp without becoming glossy.
    hsv_source = cv2.cvtColor(source_rgb, cv2.COLOR_RGB2HSV)
    source_rock = smoothstep(.48, .72, hsv_source[..., 2]) * (1.0 - smoothstep(.16, .34, hsv_source[..., 1]))
    altitude = smoothstep(.52, .88, normalized)
    rock = np.clip(slope * .58 + altitude * .26 + source_rock * .30, 0, 1)
    rock = smoothstep(.16, .88, rock)
    grass = np.clip(1.0 - rock, 0, 1)
    wetness = (1.0 - smoothstep(.07, .34, normalized)) * (1.0 - smoothstep(14.0, 34.0, slope_degrees))
    lake = cv2.resize(fields["master_lake"].astype(np.float32) / 255.0, (SIZE, SIZE), interpolation=cv2.INTER_NEAREST)
    wetness = np.clip(wetness * (1.0 - lake), 0, 1)

    # Remove only broad baked illumination.  The exponent keeps the reference's
    # authored local contrast while preventing double lighting in Blender/WebGL.
    lab = cv2.cvtColor(source_rgb, cv2.COLOR_RGB2LAB)
    luminance = lab[..., 0]
    illumination = cv2.GaussianBlur(luminance, (0, 0), 34.0)
    illumination_target = float(np.median(illumination[lake < .5]))
    neutral_luminance = luminance * np.power(
        illumination_target / np.clip(illumination, .08, None), .30
    )
    neutral_luminance *= float(np.mean(luminance[lake < .5])) / max(float(np.mean(neutral_luminance[lake < .5])), 1e-6)
    # OpenCV float Lab uses L*=0..100 (8-bit Lab uses 0..255).
    lab[..., 0] = np.clip(neutral_luminance, 0, 100)
    neutral_rgb = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)

    hsv = cv2.cvtColor(np.clip(neutral_rgb, 0, 1), cv2.COLOR_RGB2HSV)
    hue_pull = np.clip((104.0 - hsv[..., 0]) * .10, -4.0, 4.0)
    hsv[..., 0] = np.mod(hsv[..., 0] + hue_pull * grass, 360.0)
    hsv[..., 1] = np.clip(hsv[..., 1] * (1.0 + grass * .15 - rock * .07), 0, .78)
    hsv[..., 2] = np.clip(hsv[..., 2] * (1.0 - rock * .075 - wetness * .035), 0, 1)
    base_rgb_float = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)
    # A restrained unsharp pass preserves the source erosion without baking new
    # noise into grass.  It is strongest on rock faces and absent on the lake.
    softened = cv2.GaussianBlur(base_rgb_float, (0, 0), .85)
    base_rgb_float = np.clip(base_rgb_float + (base_rgb_float - softened) * (.08 + rock[..., None] * .12), 0, 1)
    base_rgb = np.uint8(base_rgb_float * 255)
    Image.fromarray(base_rgb, "RGB").save(TEXTURES / "Terrain_BaseColor.png", optimize=True)

    # Band-limited micro relief: no low-frequency mountain slope is repeated in
    # the normal texture.  Rock gets more response, grass remains calmer.
    medium = cv2.GaussianBlur(normalized, (0, 0), 2.2) - cv2.GaussianBlur(normalized, (0, 0), 11.0)
    fine = normalized - cv2.GaussianBlur(normalized, (0, 0), 2.2)
    detail_luma = cv2.cvtColor(base_rgb_float, cv2.COLOR_RGB2GRAY)
    texture_highpass = detail_luma - cv2.GaussianBlur(detail_luma, (0, 0), 1.25)
    detail_height_m = (medium * .22 + fine * .42) * relief + texture_highpass * (.018 + rock * .020)
    detail_height_m *= (1.0 - lake)
    detail_dy, detail_dx = np.gradient(detail_height_m)
    detail_dx *= SIZE / float(SPEC["dimensions"]["width_m"])
    detail_dy *= SIZE / float(SPEC["dimensions"]["depth_m"])
    detail_strength = .72 + rock * .78
    nx, ny = -detail_dx * detail_strength, detail_dy * detail_strength
    nz = np.ones_like(nx)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.dstack([(nx / length * .5 + .5), (ny / length * .5 + .5), (nz / length * .5 + .5)])
    Image.fromarray(np.uint8(np.clip(normal, 0, 1) * 255), "RGB").save(TEXTURES / "Terrain_Normal_Source.png", optimize=True)

    # Multi-scale concavity survives texture compression better than a single
    # huge blur and gives distinct erosion grooves without black crevices.
    cavity_small = percentile_unit(np.clip(cv2.GaussianBlur(height, (0, 0), 2.2) - height, 0, None), 4, 99.2)
    cavity_medium = percentile_unit(np.clip(cv2.GaussianBlur(height, (0, 0), 9.0) - height, 0, None), 4, 99.0)
    cavity_large = percentile_unit(np.clip(cv2.GaussianBlur(height, (0, 0), 28.0) - height, 0, None), 4, 99.0)
    cavity = np.clip(cavity_small * .34 + cavity_medium * .44 + cavity_large * .22, 0, 1)
    ao = np.clip(1.0 - cavity * (.28 + slope * .20) - wetness * .035, .52, 1.0)
    roughness = np.clip(.84 - rock * .13 - wetness * .17 + cavity * .035, .56, .91)
    metallic = np.zeros_like(roughness)
    save_gray(TEXTURES / "Terrain_AO_Source.png", ao)
    save_gray(TEXTURES / "Terrain_Roughness.png", roughness)
    save_gray(TEXTURES / "Terrain_Metallic.png", metallic)
    save_gray(TEXTURES / "Terrain_RockMask.png", rock)
    save_gray(TEXTURES / "Terrain_GrassMask.png", grass)
    save_gray(TEXTURES / "Terrain_Cavity.png", cavity)
    save_gray(TEXTURES / "Terrain_Wetness.png", wetness)
    Image.fromarray(np.uint8(np.dstack([ao, roughness, metallic]) * 255), "RGB").save(TEXTURES / "Terrain_ORM_Source.png", optimize=True)

    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    pattern = ((xx // 64) + (yy // 64)) % 2
    checker = np.where(pattern[..., None] == 0, np.array([12, 61, 58]), np.array([45, 131, 116])).astype(np.uint8)
    checker[:5] = checker[-5:] = checker[:, :5] = checker[:, -5:] = (86, 255, 239)
    Image.fromarray(checker, "RGB").save(TEXTURES / "Terrain_UV_Checker.png", optimize=True)

    normal_u8 = np.uint8(np.clip(normal, 0, 1) * 255)
    mask_debug = np.hstack([
        labelled_panel(base_rgb, "V4 LIGHTING-NEUTRAL BASE COLOR"),
        labelled_panel(cv2.cvtColor(np.uint8(rock * 255), cv2.COLOR_GRAY2RGB), "ROCK MASK"),
        labelled_panel(cv2.cvtColor(np.uint8(cavity * 255), cv2.COLOR_GRAY2RGB), "MULTISCALE CAVITY"),
        labelled_panel(normal_u8, "BAND-LIMITED DETAIL NORMAL"),
    ])
    Image.fromarray(mask_debug, "RGB").save(REPORTS / "surface_material_breakdown.png", optimize=True)

    color_mae = float(np.mean(np.abs(base_rgb.astype(np.float32) - source_rgb_u8.astype(np.float32))) / 255.0)
    tangent_xy = np.hypot(normal[..., 0] * 2 - 1, normal[..., 1] * 2 - 1)
    report = {
        "version": SPEC["version"],
        "texture_size": SIZE,
        "source": "rectified material reference with low-frequency illumination separation",
        "base_color_source_mae": round(color_mae, 6),
        "rock_coverage": round(float(np.mean(rock > .5)), 6),
        "grass_coverage": round(float(np.mean(grass >= .5)), 6),
        "wetness_coverage": round(float(np.mean(wetness > .35)), 6),
        "slope_degrees_p50": round(float(np.percentile(slope_degrees, 50)), 3),
        "slope_degrees_p95": round(float(np.percentile(slope_degrees, 95)), 3),
        "detail_normal_xy_p50": round(float(np.percentile(tangent_xy, 50)), 6),
        "detail_normal_xy_p95": round(float(np.percentile(tangent_xy, 95)), 6),
        "ao_range": [round(float(ao.min()), 6), round(float(ao.max()), 6)],
        "roughness_range": [round(float(roughness.min()), 6), round(float(roughness.max()), 6)],
        "metallic": 0.0,
    }
    (REPORTS / "texture_generation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
