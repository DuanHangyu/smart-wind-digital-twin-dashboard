#!/usr/bin/env python3
"""Validate V4 PBR separation and create exact-camera V3/V4 comparisons."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[2]
V3 = ROOT.parent / "B_artistic_windfarm_terrain_v3_turbine_refined"
GENERATED = ROOT / "source/generated"
TEXTURES = ROOT / "textures/png"
REPORTS = ROOT / "reports"


def read(path: Path, mode: int = cv2.IMREAD_COLOR) -> np.ndarray:
    result = cv2.imread(str(path), mode)
    if result is None:
        raise FileNotFoundError(path)
    return result


def label(image: np.ndarray, title: str) -> np.ndarray:
    result = image.copy()
    cv2.rectangle(result, (0, 0), (result.shape[1], 42), (8, 12, 13), -1)
    cv2.putText(result, title, (14, 28), cv2.FONT_HERSHEY_SIMPLEX, .66, (236, 246, 244), 1, cv2.LINE_AA)
    return result


def panel(image: np.ndarray, width: int = 720, height: int = 460) -> np.ndarray:
    return cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)


def illumination_std(image_bgr: np.ndarray) -> float:
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    broad = cv2.GaussianBlur(lab[..., 0] / 100.0, (0, 0), 34.0)
    return float(np.std(broad))


def main() -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    source = read(GENERATED / "Reference_BaseColor_Rectified.png")
    v3_base = read(V3 / "textures/png/Terrain_BaseColor.png")
    v4_base = read(TEXTURES / "Terrain_BaseColor.png")
    v3_normal = read(V3 / "textures/png/Terrain_Normal.png")
    v4_normal = read(TEXTURES / "Terrain_Normal.png")
    v4_orm = read(TEXTURES / "Terrain_ORM.png")
    source_resized = cv2.resize(source, (v4_base.shape[1], v4_base.shape[0]), interpolation=cv2.INTER_LANCZOS4)

    base_mae = float(np.mean(np.abs(v4_base.astype(np.float32) - source_resized.astype(np.float32))) / 255.0)
    source_illumination_std = illumination_std(source_resized)
    v4_illumination_std = illumination_std(v4_base)
    illumination_ratio = v4_illumination_std / max(source_illumination_std, 1e-8)

    normal_rgb = cv2.cvtColor(v4_normal, cv2.COLOR_BGR2RGB).astype(np.float32) / 127.5 - 1.0
    normal_xy = np.hypot(normal_rgb[..., 0], normal_rgb[..., 1])
    ao = v4_orm[..., 2].astype(np.float32) / 255.0
    roughness = v4_orm[..., 1].astype(np.float32) / 255.0
    metallic = v4_orm[..., 0].astype(np.float32) / 255.0

    metrics = {
        "base_color_source_mae": round(base_mae, 6),
        "source_broad_illumination_std": round(source_illumination_std, 6),
        "v4_broad_illumination_std": round(v4_illumination_std, 6),
        "broad_illumination_std_ratio": round(illumination_ratio, 6),
        "normal_xy_p50": round(float(np.percentile(normal_xy, 50)), 6),
        "normal_xy_p95": round(float(np.percentile(normal_xy, 95)), 6),
        "normal_xy_p99": round(float(np.percentile(normal_xy, 99)), 6),
        "ao_min_mean_max": [round(float(ao.min()), 6), round(float(ao.mean()), 6), round(float(ao.max()), 6)],
        "roughness_min_mean_max": [round(float(roughness.min()), 6), round(float(roughness.mean()), 6), round(float(roughness.max()), 6)],
        "metallic_mean": round(float(metallic.mean()), 6),
    }
    thresholds = {
        "base_color_source_mae_max": .06,
        "broad_illumination_std_ratio_max": .96,
        "normal_xy_p95_range": [.035, .70],
        "ao_min": .40,
        "roughness_range": [.50, .95],
        "metallic_mean_max": .01,
    }
    report = {
        "validation_basis": "locked V4 reference panels and exact-camera V3 baseline",
        "metrics": metrics,
        "thresholds": thresholds,
    }
    report["pass"] = (
        base_mae <= thresholds["base_color_source_mae_max"]
        and illumination_ratio <= thresholds["broad_illumination_std_ratio_max"]
        and thresholds["normal_xy_p95_range"][0] <= metrics["normal_xy_p95"] <= thresholds["normal_xy_p95_range"][1]
        and metrics["ao_min_mean_max"][0] >= thresholds["ao_min"]
        and metrics["roughness_min_mean_max"][0] >= thresholds["roughness_range"][0]
        and metrics["roughness_min_mean_max"][2] <= thresholds["roughness_range"][1]
        and metrics["metallic_mean"] <= thresholds["metallic_mean_max"]
    )

    texture_montage = np.vstack([
        np.hstack([
            label(panel(source_resized), "LOCKED SOURCE MATERIAL"),
            label(panel(v3_base), "V3 BASE COLOR"),
            label(panel(v4_base), "V4 LIGHTING-NEUTRAL BASE COLOR"),
        ]),
        np.hstack([
            label(panel(v3_normal), "V3 NORMAL (MACRO REPEATED)"),
            label(panel(v4_normal), "V4 NORMAL (BAND-LIMITED + RNM)"),
            label(panel(v4_orm), "V4 ORM (AO / ROUGHNESS / METALLIC)"),
        ]),
    ])
    cv2.imwrite(str(REPORTS / "surface_texture_comparison.png"), texture_montage)

    v3_render_path = V3 / "renders/B08_export_ready.png"
    v4_render_path = ROOT / "renders/B08_export_ready.png"
    if v3_render_path.exists() and v4_render_path.exists():
        v3_render = read(v3_render_path)
        v4_render = read(v4_render_path)
        render_montage = np.hstack([
            label(panel(v3_render, 900, 570), "V3 BASELINE · SAME CAMERA"),
            label(panel(v4_render, 900, 570), "V4 SURFACE REFINED · SAME CAMERA"),
        ])
        cv2.imwrite(str(REPORTS / "render_v3_v4_comparison.png"), render_montage)

    (REPORTS / "surface_validation.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["pass"] else 1)


if __name__ == "__main__":
    main()
