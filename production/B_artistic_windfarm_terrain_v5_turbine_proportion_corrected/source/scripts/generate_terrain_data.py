#!/usr/bin/env python3
"""Reconstruct terrain directly from the locked reference height/material panels."""

from __future__ import annotations

import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "source"
REFERENCE = SOURCE / "reference"
GENERATED = SOURCE / "generated"
REPORTS = ROOT / "reports"
SPEC = json.loads((SOURCE / "terrain_spec.json").read_text(encoding="utf-8"))
REG = SPEC["reference_registration"]


def transform_for(quad: list[list[float]], width: int, height: int) -> np.ndarray:
    destination = np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
    return cv2.getPerspectiveTransform(np.float32(quad), destination)


def inpaint_markers(image: np.ndarray, markers: list[list[int]], radius: int = 8) -> tuple[np.ndarray, np.ndarray]:
    mask = np.zeros(image.shape[:2], dtype=np.uint8)
    for x, y in markers:
        cv2.circle(mask, (int(x), int(y)), radius, 255, -1, cv2.LINE_AA)
    healed = cv2.inpaint(image, mask, 3, cv2.INPAINT_NS)
    # Reintroduce local texture with a nearby donor patch; plain inpainting leaves
    # visible flat discs in the reference's highly detailed erosion texture.
    for x, y in markers:
        donor_x = x - 22 if x > image.shape[1] // 2 else x + 22
        size = radius * 2 + 1
        x0, y0 = int(donor_x - radius), int(y - radius)
        patch = image[y0:y0 + size, x0:x0 + size].copy()
        if patch.shape[:2] != (size, size):
            continue
        clone_mask = np.zeros((size, size), dtype=np.uint8)
        cv2.circle(clone_mask, (radius, radius), radius - 1, 255, -1, cv2.LINE_AA)
        healed = cv2.seamlessClone(patch, healed, clone_mask, (int(x), int(y)), cv2.NORMAL_CLONE)
    return healed, mask


def warp(image: np.ndarray, matrix: np.ndarray, width: int, height: int) -> np.ndarray:
    return cv2.warpPerspective(image, matrix, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT_101)


def lake_from_height(gray: np.ndarray) -> np.ndarray:
    # The reference lake is the only large near-black closed component in the
    # lower-left quadrant.  Restricting the search avoids dark mountain valleys.
    candidate = np.zeros_like(gray, dtype=np.uint8)
    candidate[gray < 22] = 255
    candidate[: int(gray.shape[0] * 0.46), :] = 0
    candidate[:, int(gray.shape[1] * 0.50) :] = 0
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8), iterations=2)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(candidate, 8)
    eligible = [index for index in range(1, count) if stats[index, cv2.CC_STAT_AREA] > gray.size * 0.005]
    if not eligible:
        raise RuntimeError("Reference lake component could not be extracted")
    selected = max(eligible, key=lambda index: stats[index, cv2.CC_STAT_AREA])
    mask = np.uint8(labels == selected) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8), iterations=1)
    return mask


def polygon_from_mask(mask: np.ndarray, points: int = 96) -> list[list[float]]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contour = max(contours, key=cv2.contourArea)[:, 0, :].astype(np.float32)
    distances = np.linalg.norm(np.roll(contour, -1, axis=0) - contour, axis=1)
    cumulative = np.r_[0.0, np.cumsum(distances)]
    targets = np.linspace(0.0, cumulative[-1], points, endpoint=False)
    sampled = []
    for target in targets:
        index = min(int(np.searchsorted(cumulative, target, side="right") - 1), len(contour) - 1)
        next_index = (index + 1) % len(contour)
        segment = max(distances[index], 1e-6)
        factor = (target - cumulative[index]) / segment
        point = contour[index] * (1.0 - factor) + contour[next_index] * factor
        sampled.append([
            float(point[0] / (mask.shape[1] - 1) * 2.0 - 1.0),
            float(1.0 - point[1] / (mask.shape[0] - 1) * 2.0),
        ])
    return sampled


def normalize_height(gray: np.ndarray, lake: np.ndarray) -> np.ndarray:
    valid = (lake == 0)
    low, high = np.percentile(gray[valid], [1.25, 99.45])
    raw = np.clip((gray.astype(np.float32) - low) / max(high - low, 1e-6), 0.0, 1.0)
    # The grayscale panel mixes broad elevation with bright erosion crests.  The
    # broad component carries most geometric height; the high-frequency component
    # is retained at low amplitude and later reinforced by the normal map.
    broad = cv2.GaussianBlur(raw, (0, 0), 5.2)
    medium = cv2.GaussianBlur(raw, (0, 0), 1.45)
    normalized = np.clip(broad * 0.78 + medium * 0.18 + raw * 0.04, 0.0, 1.0)
    normalized -= float(normalized.min())
    normalized /= max(float(np.percentile(normalized[valid], 99.8)), 1e-6)
    normalized = np.power(np.clip(normalized, 0, 1), 1.08)
    # The rendered reference is a terrain insert on a thin rectangular plinth:
    # all four outer edges return to the base instead of exposing a tall terrain
    # cross-section.  Preserve the registered interior and taper only the outer
    # 7.5 percent with a cubic smoothstep.
    rows, columns = normalized.shape
    yy, xx = np.mgrid[0:rows, 0:columns]
    edge_distance = np.minimum.reduce([xx, columns - 1 - xx, yy, rows - 1 - yy]).astype(np.float32)
    edge_width = max(8.0, min(rows, columns) * 0.075)
    edge_fade = np.clip(edge_distance / edge_width, 0.0, 1.0)
    edge_fade = edge_fade * edge_fade * (3.0 - 2.0 * edge_fade)
    normalized *= edge_fade
    relief = float(SPEC["dimensions"]["terrain_relief_m"])
    height = normalized * relief
    bank = cv2.GaussianBlur(lake.astype(np.float32) / 255.0, (0, 0), 4.5)
    height = height * (1.0 - bank * 0.96) + 0.020 * bank
    return height.astype(np.float32)


def sample_height(heightfield: np.ndarray, nx: float, ny: float) -> float:
    h, w = heightfield.shape
    px = np.clip((nx + 1.0) * 0.5 * (w - 1), 0, w - 1)
    py = np.clip((1.0 - (ny + 1.0) * 0.5) * (h - 1), 0, h - 1)
    x0, y0 = int(math.floor(px)), int(math.floor(py))
    x1, y1 = min(x0 + 1, w - 1), min(y0 + 1, h - 1)
    tx, ty = px - x0, py - y0
    return float(heightfield[y0, x0] * (1 - tx) * (1 - ty) + heightfield[y0, x1] * tx * (1 - ty) + heightfield[y1, x0] * (1 - tx) * ty + heightfield[y1, x1] * tx * ty)


def marker_positions(matrix: np.ndarray, width: int, height: int) -> list[list[float]]:
    points = np.asarray(REG["height_turbine_markers_px"], dtype=np.float32).reshape(-1, 1, 2)
    rectified = cv2.perspectiveTransform(points, matrix)[:, 0, :]
    return [[float(x / (width - 1) * 2 - 1), float(1 - y / (height - 1) * 2)] for x, y in rectified]


def peak_catalog(height: np.ndarray, limit: int = 18) -> list[dict]:
    kernel = np.ones((17, 17), np.uint8)
    local_max = height >= cv2.dilate(height, kernel) - 1e-6
    threshold = np.percentile(height, 88)
    yy, xx = np.nonzero(local_max & (height >= threshold))
    values = height[yy, xx]
    order = np.argsort(values)[::-1]
    selected = []
    for index in order:
        x, y = int(xx[index]), int(yy[index])
        if any((x - item[0]) ** 2 + (y - item[1]) ** 2 < 32 ** 2 for item in selected):
            continue
        selected.append((x, y, float(values[index])))
        if len(selected) >= limit:
            break
    return [{
        "normalized": [round(x / (height.shape[1] - 1) * 2 - 1, 6), round(1 - y / (height.shape[0] - 1) * 2, 6)],
        "height_m": round(value, 5),
    } for x, y, value in selected]


def main() -> None:
    GENERATED.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    reference_path = REFERENCE / REG["source_image"]
    source = cv2.imread(str(reference_path), cv2.IMREAD_COLOR)
    if source is None:
        raise FileNotFoundError(reference_path)
    width, height = (int(value) for value in REG["registration_size"])
    height_matrix = transform_for(REG["height_quad_px"], width, height)
    material_matrix = transform_for(REG["material_quad_px"], width, height)

    cleaned_height_source, height_marker_mask = inpaint_markers(source, REG["height_turbine_markers_px"])
    cleaned_material_source, material_marker_mask = inpaint_markers(source, REG["material_turbine_markers_px"])
    gray_source = cv2.cvtColor(cleaned_height_source, cv2.COLOR_BGR2GRAY)
    rectified_gray = warp(gray_source, height_matrix, width, height)
    rectified_material = warp(cleaned_material_source, material_matrix, width, height)
    lake = lake_from_height(rectified_gray)
    master = normalize_height(rectified_gray, lake)

    high_w, high_h = SPEC["grids"]["high"]
    low_w, low_h = SPEC["grids"]["low"]
    base_w, base_h = SPEC["grids"]["base"]
    high_field = cv2.resize(master, (high_w, high_h), interpolation=cv2.INTER_AREA)
    low_field = cv2.resize(master, (low_w, low_h), interpolation=cv2.INTER_AREA)
    base_field = cv2.resize(master, (base_w, base_h), interpolation=cv2.INTER_AREA)
    high_lake = cv2.resize(lake, (high_w, high_h), interpolation=cv2.INTER_NEAREST)
    low_lake = cv2.resize(lake, (low_w, low_h), interpolation=cv2.INTER_NEAREST)
    polygon = polygon_from_mask(lake)
    positions = marker_positions(height_matrix, width, height)

    width_m = float(SPEC["dimensions"]["width_m"])
    depth_m = float(SPEC["dimensions"]["depth_m"])
    base_z = float(SPEC["dimensions"]["base_height_m"])
    turbines = []
    for index, (nx, ny) in enumerate(positions, start=1):
        terrain_z = sample_height(master, nx, ny)
        turbines.append({
            "id": f"{index:02d}", "name": f"风机{index:02d}", "normalized": [nx, ny],
            "source_marker_px": REG["height_turbine_markers_px"][index - 1],
            "position": [nx * width_m * 0.5, ny * depth_m * 0.5, base_z + terrain_z],
            "status": ["运行", "运行", "运行"][index - 1], "power_kw": [1680, 1510, 1755][index - 1],
        })

    np.savez_compressed(GENERATED / "terrain_fields.npz", master=master, high=high_field, low=low_field, base=base_field, master_lake=lake, high_lake=high_lake, low_lake=low_lake)
    Image.fromarray(np.uint16(np.clip(master / float(SPEC["dimensions"]["terrain_relief_m"]), 0, 1) * 65535)).save(GENERATED / "Terrain_Height_Master.png")
    Image.fromarray(np.uint16(np.clip(high_field / float(SPEC["dimensions"]["terrain_relief_m"]), 0, 1) * 65535)).save(GENERATED / "Terrain_Height_High.png")
    Image.fromarray(np.uint16(np.clip(low_field / float(SPEC["dimensions"]["terrain_relief_m"]), 0, 1) * 65535)).save(GENERATED / "Terrain_Height_Low.png")
    cv2.imwrite(str(GENERATED / "Reference_Height_Rectified.png"), rectified_gray)
    cv2.imwrite(str(GENERATED / "Reference_BaseColor_Rectified.png"), rectified_material)
    cv2.imwrite(str(GENERATED / "Reference_Lake_Mask.png"), lake)

    structure = {
        "asset": SPEC["asset"], "source_image": str(reference_path),
        "lake": {"polygon_normalized": polygon, "area_ratio": float(np.mean(lake > 0))},
        "turbines": turbines, "reference_peaks": peak_catalog(master),
    }
    (GENERATED / "terrain_structure.json").write_text(json.dumps(structure, ensure_ascii=False, indent=2), encoding="utf-8")

    registration = source.copy()
    for quad, color in [(REG["height_quad_px"], (0, 255, 255)), (REG["material_quad_px"], (255, 220, 0))]:
        cv2.polylines(registration, [np.asarray(quad, dtype=np.int32)], True, color, 3, cv2.LINE_AA)
    for marker in REG["height_turbine_markers_px"] + REG["material_turbine_markers_px"]:
        cv2.circle(registration, tuple(marker), 13, (0, 80, 255), 2, cv2.LINE_AA)
    cv2.imwrite(str(REPORTS / "reference_registration.png"), registration)
    preview_height = cv2.applyColorMap(np.uint8(np.clip(master / float(SPEC["dimensions"]["terrain_relief_m"]), 0, 1) * 255), cv2.COLORMAP_BONE)
    lake_color = cv2.cvtColor(lake, cv2.COLOR_GRAY2BGR)
    contact = np.vstack([np.hstack([cv2.resize(rectified_gray, (width, height)), cv2.cvtColor(rectified_material, cv2.COLOR_BGR2GRAY)]), np.hstack([cv2.cvtColor(preview_height, cv2.COLOR_BGR2GRAY), cv2.cvtColor(lake_color, cv2.COLOR_BGR2GRAY)])])
    cv2.imwrite(str(REPORTS / "reference_rectified_contact_sheet.png"), contact)

    report = {
        "method": "direct perspective rectification from the locked reference height/material panels",
        "source_resolution": [source.shape[1], source.shape[0]], "registration_size": [width, height],
        "height_quad_px": REG["height_quad_px"], "material_quad_px": REG["material_quad_px"],
        "turbines_normalized": [[round(v, 6) for v in item["normalized"]] for item in turbines],
        "lake_area_ratio": round(float(np.mean(lake > 0)), 6),
        "lake_center_normalized": [round(float(np.nonzero(lake)[1].mean() / (width - 1) * 2 - 1), 6), round(float(1 - np.nonzero(lake)[0].mean() / (height - 1) * 2), 6)],
        "height_min_m": round(float(master.min()), 6), "height_max_m": round(float(master.max()), 6),
        "edge_falloff_ratio": 0.075,
        "reference_peaks": structure["reference_peaks"],
    }
    (REPORTS / "reference_analysis.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
