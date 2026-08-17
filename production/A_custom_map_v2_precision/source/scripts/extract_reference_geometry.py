#!/usr/bin/env python3
"""Extract the authoritative outline and closed regions from the clean line-art panel."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from shapely.geometry import Polygon


ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "source/reference/reference_six_views_states.png"
GENERATED = ROOT / "source/generated"
REPORTS = ROOT / "reports"
TARGET_WIDTH_METERS = 12.0
REGION_NAMES = [
    "北辰", "云岭", "西原", "苍川", "中岳", "东岚", "河源",
    "青泽", "临海", "南川", "星湾", "湖心", "新城", "南港",
]


def contour_points(mask: np.ndarray, epsilon: float) -> list[list[float]]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        raise RuntimeError("No contour found")
    contour = max(contours, key=cv2.contourArea)
    simplified = cv2.approxPolyDP(contour, epsilon, True)[:, 0, :]
    polygon = Polygon(simplified)
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    if polygon.geom_type != "Polygon":
        polygon = max(polygon.geoms, key=lambda item: item.area)
    return [[float(x), float(y)] for x, y in polygon.exterior.coords[:-1]]


def normalize(points: list[list[float]], bounds: tuple[float, float, float, float]) -> list[list[float]]:
    min_x, min_y, max_x, max_y = bounds
    scale = TARGET_WIDTH_METERS / (max_x - min_x)
    center_x = (min_x + max_x) * 0.5
    center_y = (min_y + max_y) * 0.5
    return [[round((x - center_x) * scale, 6), round((center_y - y) * scale, 6)] for x, y in points]


def inset(points: list[list[float]], distance: float) -> list[list[float]]:
    polygon = Polygon(points)
    result = polygon.buffer(-distance, join_style="mitre")
    if result.is_empty:
        return points
    if result.geom_type != "Polygon":
        result = max(result.geoms, key=lambda item: item.area)
    return [[round(float(x), 6), round(float(y), 6)] for x, y in list(result.exterior.coords)[:-1]]


def main() -> None:
    GENERATED.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    image = cv2.imread(str(REFERENCE), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(REFERENCE)
    height, width = image.shape[:2]

    # The clean top-middle panel contains only the complete connected boundary network.
    panel_width = width // 3
    panel_height = height // 2
    x0, x1 = panel_width + 12, panel_width * 2 - 12
    y0, y1 = 12, panel_height - 12
    crop = image[y0:y1, x0:x1].copy()
    blue, green, red = cv2.split(crop)
    cyan_score = (blue.astype(np.int16) + green.astype(np.int16)) // 2 - red.astype(np.int16)
    line_mask = ((green > 105) & (blue > 105) & (cyan_score > 42)).astype(np.uint8) * 255

    # Seal sub-pixel anti-aliasing gaps without smoothing away the jagged character.
    line_mask = cv2.morphologyEx(line_mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=1)
    line_mask = cv2.dilate(line_mask, np.ones((2, 2), np.uint8), iterations=1)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(line_mask, 8)
    candidates = [(int(stats[index, cv2.CC_STAT_AREA]), index) for index in range(1, count)]
    if not candidates:
        raise RuntimeError("Cyan network was not detected")
    network_index = max(candidates)[1]
    network = (labels == network_index).astype(np.uint8) * 255

    # Crop again around the network to remove panel borders and ensure the exterior is one component.
    ys, xs = np.where(network > 0)
    pad = 8
    bx0, bx1 = max(int(xs.min()) - pad, 0), min(int(xs.max()) + pad + 1, crop.shape[1])
    by0, by1 = max(int(ys.min()) - pad, 0), min(int(ys.max()) + pad + 1, crop.shape[0])
    crop = crop[by0:by1, bx0:bx1]
    network = network[by0:by1, bx0:bx1]

    inverse = cv2.bitwise_not(network)
    region_count, region_labels, region_stats, region_centroids = cv2.connectedComponentsWithStats(inverse, 8)
    region_indices = []
    for index in range(1, region_count):
        x, y, w, h, area = region_stats[index]
        touches_border = x == 0 or y == 0 or x + w == inverse.shape[1] or y + h == inverse.shape[0]
        if not touches_border and area >= 250:
            region_indices.append(index)

    if not 12 <= len(region_indices) <= 18:
        raise RuntimeError(f"Expected 12–18 closed regions, found {len(region_indices)}")

    # Sort north-to-south, then west-to-east for stable PART IDs.
    region_indices.sort(key=lambda index: (round(region_centroids[index][1] / 65), region_centroids[index][0]))
    outline_contours, _ = cv2.findContours(network, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    outer_contour = max(outline_contours, key=cv2.contourArea)
    outer_mask = np.zeros_like(network)
    cv2.drawContours(outer_mask, [outer_contour], -1, 255, cv2.FILLED)
    outer_high_px = contour_points(outer_mask, 0.45)
    outer_low_px = contour_points(outer_mask, 0.85)
    all_outer = np.asarray(outer_high_px)
    bounds = (
        float(all_outer[:, 0].min()),
        float(all_outer[:, 1].min()),
        float(all_outer[:, 0].max()),
        float(all_outer[:, 1].max()),
    )

    palette = [
        (45, 201, 191), (53, 184, 210), (58, 217, 178), (74, 186, 232),
        (88, 221, 206), (70, 171, 207), (103, 211, 187), (42, 193, 221),
        (76, 221, 161), (90, 192, 224), (58, 215, 214), (95, 182, 203),
        (51, 201, 170), (69, 211, 225), (113, 202, 197), (39, 180, 208),
    ]
    diagnostic = cv2.cvtColor(network, cv2.COLOR_GRAY2BGR)
    diagnostic[:] = (14, 18, 19)
    regions = []
    for order, index in enumerate(region_indices, start=1):
        region_mask = (region_labels == index).astype(np.uint8) * 255
        # Expand to the middle of the luminous separator; export stage later adds a controlled gap.
        region_mask = cv2.dilate(region_mask, np.ones((3, 3), np.uint8), iterations=1)
        high_px = contour_points(region_mask, 0.42)
        low_px = contour_points(region_mask, 0.72)
        centroid = region_centroids[index]
        color = palette[(order - 1) % len(palette)]
        diagnostic[region_mask > 0] = color
        cv2.drawContours(diagnostic, [np.asarray(high_px, np.int32)], -1, (238, 255, 159), 1, cv2.LINE_AA)
        cv2.putText(
            diagnostic,
            f"{order:02d}",
            (int(centroid[0]) - 8, int(centroid[1]) + 4),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.35,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )
        high = normalize(high_px, bounds)
        low = normalize(low_px, bounds)
        high_polygon = Polygon(high)
        regions.append({
            "id": f"{order:02d}",
            "name": REGION_NAMES[order - 1],
            "value": 68 + ((order * 11) % 29),
            "centroid_px": [round(float(centroid[0]), 3), round(float(centroid[1]), 3)],
            "centroid": [round(high_polygon.centroid.x, 6), round(high_polygon.centroid.y, 6)],
            "area_px": int(region_stats[index, cv2.CC_STAT_AREA]),
            "high": high,
            "high_gap": inset(high, 0.016),
            "low": low,
            "low_gap": inset(low, 0.016),
        })

    cv2.imwrite(str(GENERATED / "reference_topology_crop.png"), crop)
    cv2.imwrite(str(REPORTS / "trace_diagnostic.png"), diagnostic)
    cv2.imwrite(str(REPORTS / "trace_network_mask.png"), network)

    geometry = {
        "asset": "A_CUSTOM_MAP_V2_PRECISION",
        "reference": str(REFERENCE),
        "source_panel": "top-middle boundary-only panel",
        "crop_in_source": [x0 + bx0, y0 + by0, x0 + bx1, y0 + by1],
        "target_width_m": TARGET_WIDTH_METERS,
        "bounds_px": list(bounds),
        "outline": {
            "high": normalize(outer_high_px, bounds),
            "low": normalize(outer_low_px, bounds),
        },
        "regions": regions,
    }
    (GENERATED / "reference_geometry.json").write_text(
        json.dumps(geometry, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = {
        "image_size": [width, height],
        "network_crop_size": [int(network.shape[1]), int(network.shape[0])],
        "regions": len(regions),
        "outline_points_high": len(outer_high_px),
        "outline_points_low": len(outer_low_px),
        "region_points_high_total": sum(len(region["high"]) for region in regions),
        "region_points_low_total": sum(len(region["low"]) for region in regions),
        "aspect_ratio": round((bounds[2] - bounds[0]) / (bounds[3] - bounds[1]), 5),
    }
    (REPORTS / "trace_metrics.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
