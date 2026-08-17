#!/usr/bin/env python3
"""Validate the web asset against the locked source-reference registration.

This deliberately separates source-to-model checks from high-to-low checks.  A
procedural master comparing with itself is not evidence of reference fidelity.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[2]
SPEC = json.loads((ROOT / "source/terrain_spec.json").read_text(encoding="utf-8"))
STRUCTURE = json.loads((ROOT / "source/generated/terrain_structure.json").read_text(encoding="utf-8"))
REPORTS = ROOT / "reports"
GENERATED = ROOT / "source/generated"


def normalize_valid(image: np.ndarray, valid: np.ndarray) -> np.ndarray:
    values = image[valid]
    low, high = np.percentile(values, [1.25, 99.45])
    return np.clip((image.astype(np.float32) - low) / max(float(high - low), 1e-6), 0.0, 1.0)


def polygon_mask(shape: tuple[int, int], polygon: list[list[float]]) -> np.ndarray:
    height, width = shape
    points = np.asarray([
        [round((x + 1.0) * 0.5 * (width - 1)), round((1.0 - y) * 0.5 * (height - 1))]
        for x, y in polygon
    ], dtype=np.int32)
    mask = np.zeros(shape, dtype=np.uint8)
    cv2.fillPoly(mask, [points], 255, cv2.LINE_AA)
    return mask > 127


def marker_positions_from_source() -> np.ndarray:
    registration = SPEC["reference_registration"]
    width, height = (int(value) for value in registration["registration_size"])
    destination = np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
    matrix = cv2.getPerspectiveTransform(np.float32(registration["height_quad_px"]), destination)
    source = np.asarray(registration["height_turbine_markers_px"], dtype=np.float32).reshape(-1, 1, 2)
    rectified = cv2.perspectiveTransform(source, matrix)[:, 0, :]
    return np.asarray([[x / (width - 1) * 2.0 - 1.0, 1.0 - y / (height - 1) * 2.0] for x, y in rectified])


def label(image: np.ndarray, title: str) -> np.ndarray:
    result = image.copy()
    cv2.rectangle(result, (0, 0), (result.shape[1], 34), (8, 12, 13), -1)
    cv2.putText(result, title, (12, 23), cv2.FONT_HERSHEY_SIMPLEX, .58, (232, 244, 243), 1, cv2.LINE_AA)
    return result


def main() -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    fields = np.load(GENERATED / "terrain_fields.npz")
    master = fields["master"].astype(np.float32)
    low = fields["low"].astype(np.float32)
    source_lake = fields["master_lake"] > 0
    relief = float(SPEC["dimensions"]["terrain_relief_m"])

    reference_gray = cv2.imread(str(GENERATED / "Reference_Height_Rectified.png"), cv2.IMREAD_GRAYSCALE)
    reference_color = cv2.imread(str(GENERATED / "Reference_BaseColor_Rectified.png"), cv2.IMREAD_COLOR)
    authored_color = cv2.imread(str(ROOT / "textures/png/Terrain_BaseColor.png"), cv2.IMREAD_COLOR)
    if reference_gray is None or reference_color is None or authored_color is None:
        raise FileNotFoundError("Reference rectification or PBR textures are missing")

    reference_valid = ~source_lake
    source_normalized = normalize_valid(reference_gray, reference_valid)
    source_macro = cv2.GaussianBlur(source_normalized, (0, 0), 5.2)
    model_normalized = np.clip(master / relief, 0.0, 1.0)
    # The perspective source panels do not encode an exact vertical skirt at
    # their crop boundary.  Compare registered landforms in the interior and
    # validate the intentionally authored plinth falloff separately by render.
    border = max(8, round(min(master.shape) * 0.075))
    valid = reference_valid.copy()
    valid[:border] = valid[-border:] = False
    valid[:, :border] = valid[:, -border:] = False
    source_values = source_macro[valid].ravel()
    model_values = model_normalized[valid].ravel()
    source_model_corr = float(np.corrcoef(source_values, model_values)[0, 1])

    upsampled = cv2.resize(low, (master.shape[1], master.shape[0]), interpolation=cv2.INTER_CUBIC)
    low_error = np.abs(master - upsampled) / relief
    front_master = master.max(axis=0) / relief
    front_low = cv2.resize(low.max(axis=0)[None, :], (master.shape[1], 1), interpolation=cv2.INTER_CUBIC)[0] / relief
    side_master = master.max(axis=1) / relief
    side_low = cv2.resize(low.max(axis=1)[:, None], (1, master.shape[0]), interpolation=cv2.INTER_CUBIC)[:, 0] / relief

    reconstructed_lake = polygon_mask(source_lake.shape, STRUCTURE["lake"]["polygon_normalized"])
    lake_intersection = np.count_nonzero(source_lake & reconstructed_lake)
    lake_union = np.count_nonzero(source_lake | reconstructed_lake)
    lake_iou = float(lake_intersection / max(lake_union, 1))

    source_markers = marker_positions_from_source()
    model_markers = np.asarray([item["normalized"] for item in STRUCTURE["turbines"]], dtype=np.float64)
    marker_errors = np.linalg.norm(source_markers - model_markers, axis=1)

    reference_color_size = cv2.resize(reference_color, (authored_color.shape[1], authored_color.shape[0]), interpolation=cv2.INTER_LANCZOS4)
    color_delta = np.abs(authored_color.astype(np.float32) - reference_color_size.astype(np.float32)) / 255.0
    base_color_mae = float(color_delta.mean())

    report = {
        "validation_basis": "locked reference panels registered in source/terrain_spec.json",
        "source_to_model": {
            "macro_height_pearson_correlation": round(source_model_corr, 6),
            "lake_polygon_iou": round(lake_iou, 6),
            "turbine_marker_max_error_normalized": round(float(marker_errors.max()), 9),
            "base_color_mae_normalized": round(base_color_mae, 6),
        },
        "high_to_web_low": {
            "normalized_height_rmse": round(float(np.sqrt(np.mean(np.square((master - upsampled) / relief)))), 6),
            "normalized_height_mae": round(float(low_error.mean()), 6),
            "normalized_height_p95": round(float(np.percentile(low_error, 95)), 6),
            "front_silhouette_rmse": round(float(np.sqrt(np.mean(np.square(front_master - front_low)))), 6),
            "side_silhouette_rmse": round(float(np.sqrt(np.mean(np.square(side_master - side_low)))), 6),
        },
        "structure": {
            "terrain_aspect": round(float(SPEC["dimensions"]["width_m"] / SPEC["dimensions"]["depth_m"]), 6),
            "lake_area_ratio": round(float(source_lake.mean()), 6),
            "turbines_normalized": [[round(float(value), 6) for value in marker] for marker in model_markers],
        },
        "thresholds": {
            "macro_height_correlation_min": 0.96,
            "lake_polygon_iou_min": 0.97,
            "turbine_marker_error_max": 0.000001,
            "base_color_mae_max": 0.06,
            "lowpoly_height_rmse_max": 0.025,
            "silhouette_rmse_max": 0.035,
        },
    }
    source_metrics = report["source_to_model"]
    low_metrics = report["high_to_web_low"]
    report["pass"] = (
        source_metrics["macro_height_pearson_correlation"] >= 0.96
        and source_metrics["lake_polygon_iou"] >= 0.97
        and source_metrics["turbine_marker_max_error_normalized"] <= 0.000001
        and source_metrics["base_color_mae_normalized"] <= 0.06
        and low_metrics["normalized_height_rmse"] <= 0.025
        and low_metrics["front_silhouette_rmse"] <= 0.035
        and low_metrics["side_silhouette_rmse"] <= 0.035
    )

    panel_size = (641, 413)
    source_height_panel = cv2.cvtColor(np.uint8(np.clip(source_normalized, 0, 1) * 255), cv2.COLOR_GRAY2BGR)
    model_height_panel = cv2.cvtColor(np.uint8(model_normalized * 255), cv2.COLOR_GRAY2BGR)
    height_delta = cv2.applyColorMap(np.uint8(np.clip(np.abs(source_macro - model_normalized) * 3.0, 0, 1) * 255), cv2.COLORMAP_TURBO)
    reference_panel = cv2.resize(reference_color, panel_size, interpolation=cv2.INTER_AREA)
    authored_panel = cv2.resize(authored_color, panel_size, interpolation=cv2.INTER_AREA)
    color_error_panel = cv2.applyColorMap(np.uint8(np.clip(cv2.resize(color_delta.mean(axis=2), panel_size) * 5.0, 0, 1) * 255), cv2.COLORMAP_TURBO)
    montage = np.vstack([
        np.hstack([label(source_height_panel, "SOURCE HEIGHT PANEL"), label(model_height_panel, "MODEL HEIGHT"), label(height_delta, "HEIGHT DIFFERENCE x3")]),
        np.hstack([label(reference_panel, "SOURCE MATERIAL PANEL"), label(authored_panel, "AUTHORED BASE COLOR"), label(color_error_panel, "COLOR DIFFERENCE x5")]),
    ])
    cv2.imwrite(str(REPORTS / "source_reference_vs_model.png"), montage)
    (REPORTS / "fidelity_metrics.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["pass"] else 1)


if __name__ == "__main__":
    main()
