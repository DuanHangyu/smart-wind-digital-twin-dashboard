#!/usr/bin/env python3
"""Quantify the precision low-poly outline against the traced reference geometry."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[2]
GEOMETRY = json.loads((ROOT / "source/generated/reference_geometry.json").read_text(encoding="utf-8"))
SPEC = json.loads((ROOT / "source/map_spec.json").read_text(encoding="utf-8"))
REPORT_DIR = ROOT / "reports"
CANVAS = 2048
PAD = 96


def all_bounds() -> tuple[float, float, float, float]:
    points = GEOMETRY["outline"]["high"]
    return (
        min(point[0] for point in points), min(point[1] for point in points),
        max(point[0] for point in points), max(point[1] for point in points),
    )


BOUNDS = all_bounds()
SCALE = (CANVAS - PAD * 2) / (BOUNDS[2] - BOUNDS[0])


def pixels(points: list[list[float]]) -> np.ndarray:
    min_x, min_y, max_x, max_y = BOUNDS
    return np.asarray([
        [
            round(PAD + (x - min_x) * SCALE),
            round(CANVAS - PAD - (y - min_y) * SCALE),
        ]
        for x, y in points
    ], dtype=np.int32)


def mask(points: list[list[float]]) -> np.ndarray:
    result = np.zeros((CANVAS, CANVAS), dtype=np.uint8)
    cv2.fillPoly(result, [pixels(points)], 255)
    return result


def line_mask(polygons: list[list[list[float]]]) -> np.ndarray:
    result = np.zeros((CANVAS, CANVAS), dtype=np.uint8)
    for polygon in polygons:
        cv2.polylines(result, [pixels(polygon)], True, 255, 1, cv2.LINE_8)
    return result


def iou(first: np.ndarray, second: np.ndarray) -> float:
    intersection = np.count_nonzero((first > 0) & (second > 0))
    union = np.count_nonzero((first > 0) | (second > 0))
    return intersection / max(union, 1)


def side_reference_ratio() -> tuple[float, list[int]]:
    source = cv2.imread(str(ROOT / "source/reference/reference_six_views_primary.png"))
    height, width = source.shape[:2]
    panel = source[8:height // 2 - 8, width * 2 // 3 + 8:width - 8]
    blue, green, red = cv2.split(panel)
    cyan = (
        (green > 35) & (blue > 35)
        & (((green.astype(np.int16) + blue.astype(np.int16)) // 2 - red.astype(np.int16)) > 10)
    ).astype(np.uint8) * 255
    cyan = cv2.morphologyEx(cyan, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=1)
    count, _, stats, _ = cv2.connectedComponentsWithStats(cyan, 8)
    candidates = [stats[index] for index in range(1, count) if stats[index, cv2.CC_STAT_AREA] > 300]
    if not candidates:
        return 0.0, [0, 0, 0, 0]
    x, y, w, h, _ = max(candidates, key=lambda item: item[cv2.CC_STAT_AREA])
    return float(h / w), [int(x), int(y), int(w), int(h)]


def main() -> None:
    high_outline = mask(GEOMETRY["outline"]["high"])
    low_outline = mask(GEOMETRY["outline"]["low"])
    outline_iou = iou(high_outline, low_outline)

    region_ious = []
    for region in GEOMETRY["regions"]:
        # Compare like-for-like inset contours; the controlled separator gap is intentional.
        region_ious.append(iou(mask(region["high_gap"]), mask(region["low_gap"])))

    high_lines = line_mask([region["high"] for region in GEOMETRY["regions"]])
    low_lines = line_mask([region["low"] for region in GEOMETRY["regions"]])
    distance_to_low = cv2.distanceTransform(cv2.bitwise_not(low_lines), cv2.DIST_L2, 5)
    distance_to_high = cv2.distanceTransform(cv2.bitwise_not(high_lines), cv2.DIST_L2, 5)
    symmetric_error_canvas = (
        float(distance_to_low[high_lines > 0].mean())
        + float(distance_to_high[low_lines > 0].mean())
    ) * 0.5
    reference_px_scale = (CANVAS - PAD * 2) / GEOMETRY["network_crop_size"][0] if "network_crop_size" in GEOMETRY else (CANVAS - PAD * 2) / 492
    symmetric_error_reference_px = symmetric_error_canvas / reference_px_scale

    reference_ratio, reference_bbox = side_reference_ratio()
    model_ratio = float(SPEC["dimensions"]["depth_m"]) / float(SPEC["dimensions"]["width_m"])
    ratio_error = abs(model_ratio - reference_ratio)

    overlay = np.zeros((CANVAS, CANVAS, 3), dtype=np.uint8)
    overlay[high_outline > 0] = (48, 116, 109)
    overlay[(low_outline > 0) & (high_outline > 0)] = (52, 173, 162)
    overlay[(low_outline > 0) & (high_outline == 0)] = (207, 84, 191)
    cv2.polylines(overlay, [pixels(GEOMETRY["outline"]["high"])], True, (81, 255, 246), 3, cv2.LINE_AA)
    cv2.polylines(overlay, [pixels(GEOMETRY["outline"]["low"])], True, (255, 187, 66), 1, cv2.LINE_AA)
    for region in GEOMETRY["regions"]:
        cv2.polylines(overlay, [pixels(region["high"])], True, (74, 247, 230), 2, cv2.LINE_AA)
        cv2.polylines(overlay, [pixels(region["low"])], True, (255, 196, 77), 1, cv2.LINE_AA)
    cv2.imwrite(str(REPORT_DIR / "reference_vs_lowpoly_overlay.png"), overlay)

    report = {
        "outline_iou_high_vs_low": round(outline_iou, 6),
        "region_iou_mean_high_gap_vs_low_gap": round(float(np.mean(region_ious)), 6),
        "region_iou_min_high_gap_vs_low_gap": round(float(np.min(region_ious)), 6),
        "boundary_symmetric_mean_error_reference_px": round(symmetric_error_reference_px, 4),
        "reference_side_ratio": round(reference_ratio, 6),
        "reference_side_bbox_px": reference_bbox,
        "model_depth_width_ratio": round(model_ratio, 6),
        "depth_width_ratio_absolute_error": round(ratio_error, 6),
        "thresholds": {
            "outline_iou_min": 0.99,
            "region_iou_mean_min": 0.97,
            "boundary_error_reference_px_max": 1.25,
            "depth_width_ratio_error_max": 0.015,
        },
    }
    report["pass"] = (
        report["outline_iou_high_vs_low"] >= report["thresholds"]["outline_iou_min"]
        and report["region_iou_mean_high_gap_vs_low_gap"] >= report["thresholds"]["region_iou_mean_min"]
        and report["boundary_symmetric_mean_error_reference_px"] <= report["thresholds"]["boundary_error_reference_px_max"]
        and report["depth_width_ratio_absolute_error"] <= report["thresholds"]["depth_width_ratio_error_max"]
    )
    (REPORT_DIR / "fidelity_metrics.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["pass"] else 1)


if __name__ == "__main__":
    main()
