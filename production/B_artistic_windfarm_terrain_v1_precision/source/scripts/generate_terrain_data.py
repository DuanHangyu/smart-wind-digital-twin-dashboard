#!/usr/bin/env python3
"""Generate the deterministic terrain heightfields from the locked multiview analysis."""

from __future__ import annotations

import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "source"
GENERATED = SOURCE / "generated"
REPORTS = ROOT / "reports"
SPEC = json.loads((SOURCE / "terrain_spec.json").read_text(encoding="utf-8"))


def value_noise(width: int, height: int, seed: int, octaves: int = 6) -> np.ndarray:
    rng = np.random.default_rng(seed)
    result = np.zeros((height, width), dtype=np.float32)
    amplitude = 1.0
    total = 0.0
    for octave in range(octaves):
        grid_w = 4 * (2 ** octave) + 1
        grid_h = max(3, round(grid_w * height / width))
        grid = rng.random((grid_h, grid_w), dtype=np.float32)
        layer = cv2.resize(grid, (width, height), interpolation=cv2.INTER_CUBIC)
        result += layer * amplitude
        total += amplitude
        amplitude *= 0.52
    result /= total
    return np.clip(result, 0.0, 1.0)


def segment_distance(
    x: np.ndarray, y: np.ndarray, first: tuple[float, float], second: tuple[float, float]
) -> np.ndarray:
    ax, ay = first
    bx, by = second
    dx, dy = bx - ax, by - ay
    denom = max(dx * dx + dy * dy, 1e-8)
    t = np.clip(((x - ax) * dx + (y - ay) * dy) / denom, 0.0, 1.0)
    return np.hypot(x - (ax + t * dx), y - (ay + t * dy))


def smooth_polyline(points: list[tuple[float, float]], iterations: int = 3) -> list[tuple[float, float]]:
    result = points[:]
    for _ in range(iterations):
        refined = [result[0]]
        for first, second in zip(result[:-1], result[1:]):
            refined.append((first[0] * 0.75 + second[0] * 0.25, first[1] * 0.75 + second[1] * 0.25))
            refined.append((first[0] * 0.25 + second[0] * 0.75, first[1] * 0.25 + second[1] * 0.75))
        refined.append(result[-1])
        result = refined
    return result


def polyline_ridge(
    x: np.ndarray,
    y: np.ndarray,
    points: list[tuple[float, float]],
    width: float,
    amplitude: float,
    detail: np.ndarray,
) -> np.ndarray:
    points = smooth_polyline(points, 3)
    distance = np.full_like(x, 10.0, dtype=np.float32)
    for first, second in zip(points[:-1], points[1:]):
        distance = np.minimum(distance, segment_distance(x, y, first, second))
    local_width = width * (0.78 + 0.42 * cv2.GaussianBlur(detail, (0, 0), 2.2))
    profile = np.exp(-np.square(distance / local_width) * 1.68)
    crest = 0.46 + 0.54 * np.power(np.clip(1.0 - np.abs(detail * 2.0 - 1.0), 0.0, 1.0), 1.8)
    return amplitude * profile * crest


def gaussian_peak(
    x: np.ndarray, y: np.ndarray, cx: float, cy: float, sx: float, sy: float, amplitude: float
) -> np.ndarray:
    return amplitude * np.exp(-0.5 * (np.square((x - cx) / sx) + np.square((y - cy) / sy)))


def lake_polygon() -> list[list[float]]:
    center_x, center_y = SPEC["reference_targets"]["lake_center_normalized"]
    points = []
    rotation = -0.16
    for index in range(64):
        angle = index / 64.0 * math.tau
        irregular = 1.0 + 0.07 * math.sin(angle * 5.0 + 0.4) + 0.045 * math.sin(angle * 9.0 - 0.8)
        px = 0.255 * irregular * math.cos(angle)
        py = 0.145 * irregular * math.sin(angle)
        points.append([
            center_x + px * math.cos(rotation) - py * math.sin(rotation),
            center_y + px * math.sin(rotation) + py * math.cos(rotation),
        ])
    return points


def polygon_mask(width: int, height: int, polygon: list[list[float]]) -> np.ndarray:
    pixels = np.asarray([
        [round((x + 1.0) * 0.5 * (width - 1)), round((1.0 - (y + 1.0) * 0.5) * (height - 1))]
        for x, y in polygon
    ], dtype=np.int32)
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(mask, [pixels], 255)
    return mask


def generate_height(width: int, height: int, polygon: list[list[float]], seed: int = 8127) -> tuple[np.ndarray, np.ndarray]:
    xs = np.linspace(-1.0, 1.0, width, dtype=np.float32)
    ys = np.linspace(1.0, -1.0, height, dtype=np.float32)
    x, y = np.meshgrid(xs, ys)
    broad = value_noise(width, height, seed, 5)
    detail = value_noise(width, height, seed + 101, 7)
    fine = value_noise(width, height, seed + 509, 7)
    medium = value_noise(width, height, seed + 337, 6)
    warp_x = value_noise(width, height, seed + 911, 5)
    warp_y = value_noise(width, height, seed + 1217, 5)
    grid_y, grid_x = np.mgrid[0:height, 0:width].astype(np.float32)
    warped = cv2.remap(
        fine,
        grid_x + (warp_x - 0.5) * width * 0.055,
        grid_y + (warp_y - 0.5) * height * 0.055,
        interpolation=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REFLECT,
    )
    erosion_ridges = np.power(np.clip(1.0 - np.abs(warped * 2.0 - 1.0), 0.0, 1.0), 3.4)
    # This wider ridge band survives the 129x97 web topology and prevents the
    # mountain groups from reading as smooth Gaussian cones.
    medium_ridges = np.power(
        np.clip(1.0 - np.abs(cv2.GaussianBlur(medium, (0, 0), 0.72) * 2.0 - 1.0), 0.0, 1.0),
        5.2,
    )

    heightfield = 0.055 + 0.245 * broad + 0.075 * erosion_ridges
    ridges = [
        ([(-0.92, -0.38), (-0.66, -0.30), (-0.42, -0.50), (-0.12, -0.38),
          (0.16, -0.55), (0.42, -0.37), (0.70, -0.47), (0.94, -0.32)], 0.115, 1.08),
        ([(-0.93, 0.56), (-0.70, 0.42), (-0.49, 0.22), (-0.31, 0.05), (-0.05, 0.15)], 0.125, 0.87),
        ([(-0.54, 0.78), (-0.30, 0.63), (-0.06, 0.74), (0.18, 0.56),
          (0.41, 0.70), (0.67, 0.55), (0.93, 0.63)], 0.105, 0.94),
        ([(-0.16, -0.02), (0.08, 0.16), (0.30, 0.02), (0.53, 0.20), (0.80, 0.09)], 0.105, 0.78),
    ]
    for points, width_value, amplitude in ridges:
        heightfield += polyline_ridge(x, y, points, width_value, amplitude, warped)

    branches = [
        ([(-0.69, 0.43), (-0.82, 0.25), (-0.88, 0.04)], 0.075, 0.40),
        ([(-0.66, 0.40), (-0.48, 0.29), (-0.37, 0.08)], 0.070, 0.39),
        ([(-0.32, 0.64), (-0.42, 0.46), (-0.30, 0.29)], 0.068, 0.34),
        ([(0.18, 0.60), (0.03, 0.43), (-0.02, 0.24)], 0.070, 0.42),
        ([(0.43, 0.65), (0.36, 0.44), (0.48, 0.28)], 0.068, 0.36),
        ([(-0.44, -0.45), (-0.54, -0.62), (-0.43, -0.78)], 0.070, 0.33),
        ([(-0.05, -0.41), (-0.17, -0.61), (-0.08, -0.83)], 0.072, 0.42),
        ([(0.25, -0.48), (0.36, -0.65), (0.33, -0.84)], 0.070, 0.34),
        ([(0.62, -0.42), (0.73, -0.62), (0.69, -0.82)], 0.067, 0.31),
        ([(0.53, 0.15), (0.67, 0.31), (0.73, 0.48)], 0.065, 0.30),
    ]
    for points, width_value, amplitude in branches:
        heightfield += polyline_ridge(x, y, points, width_value, amplitude, warped)

    peaks = [
        (-0.68, 0.38, 0.16, 0.14, 0.48), (-0.42, -0.35, 0.16, 0.14, 0.42),
        (-0.08, -0.40, 0.15, 0.12, 0.62), (0.24, -0.48, 0.14, 0.12, 0.46),
        (-0.15, 0.62, 0.15, 0.13, 0.42), (0.20, 0.69, 0.16, 0.13, 0.70),
        (0.55, 0.10, 0.15, 0.13, 0.48), (0.74, 0.54, 0.13, 0.11, 0.34),
        (-0.30, 0.33, 0.095, 0.085, 0.32), (0.02, 0.31, 0.10, 0.085, 0.38),
        (0.36, 0.34, 0.095, 0.080, 0.33), (-0.78, -0.05, 0.11, 0.09, 0.29),
        (0.77, -0.10, 0.10, 0.085, 0.28), (-0.52, 0.70, 0.09, 0.075, 0.24),
    ]
    for peak in peaks:
        heightfield += gaussian_peak(x, y, *peak)

    # A broad S-shaped low valley is visible in both the material and height references.
    valley_points = [(0.08, 0.94), (0.02, 0.65), (0.13, 0.35), (0.04, 0.08), (0.20, -0.18), (0.08, -0.55)]
    valley_distance = np.full_like(x, 10.0)
    for first, second in zip(valley_points[:-1], valley_points[1:]):
        valley_distance = np.minimum(valley_distance, segment_distance(x, y, first, second))
    heightfield -= 0.29 * np.exp(-np.square(valley_distance / 0.105))

    # Fine erosion-like ridges are modulated by the large mountain masks.
    relief_mask = np.clip((heightfield - 0.12) / 1.4, 0.0, 1.0)
    heightfield += (erosion_ridges - 0.30) * 0.67 * relief_mask
    heightfield += (medium_ridges - 0.24) * 0.22 * np.power(relief_mask, 0.78)
    heightfield += (np.power(np.clip(1.0 - np.abs(detail * 2.0 - 1.0), 0.0, 1.0), 4.2) - 0.22) * 0.12 * relief_mask
    heightfield += (detail - 0.5) * 0.085
    heightfield += (fine - 0.5) * 0.065 * relief_mask
    heightfield = cv2.GaussianBlur(heightfield.astype(np.float32), (0, 0), 0.18)

    # Form the shallow lake basin with a softened bank, retaining the irregular outline.
    mask = polygon_mask(width, height, polygon)
    softness = cv2.GaussianBlur(mask.astype(np.float32) / 255.0, (0, 0), max(width / 260.0, 1.0))
    bank = cv2.GaussianBlur(mask.astype(np.float32) / 255.0, (0, 0), max(width / 80.0, 2.0))
    heightfield -= 0.26 * bank

    heightfield -= float(heightfield.min())
    scale = np.percentile(heightfield, 99.75)
    heightfield = np.clip(heightfield / max(scale, 1e-6), 0.0, 1.0)
    heightfield = np.power(heightfield, 1.08) * float(SPEC["dimensions"]["terrain_relief_m"])
    basin_height = 0.035
    heightfield = heightfield * (1.0 - softness * 0.96) + basin_height * softness
    return heightfield.astype(np.float32), mask


def sample_height(heightfield: np.ndarray, nx: float, ny: float) -> float:
    height, width = heightfield.shape
    px = np.clip((nx + 1.0) * 0.5 * (width - 1), 0, width - 1)
    py = np.clip((1.0 - (ny + 1.0) * 0.5) * (height - 1), 0, height - 1)
    x0, y0 = int(math.floor(px)), int(math.floor(py))
    x1, y1 = min(x0 + 1, width - 1), min(y0 + 1, height - 1)
    tx, ty = px - x0, py - y0
    return float(
        heightfield[y0, x0] * (1 - tx) * (1 - ty)
        + heightfield[y0, x1] * tx * (1 - ty)
        + heightfield[y1, x0] * (1 - tx) * ty
        + heightfield[y1, x1] * tx * ty
    )


def save_height_preview(heightfield: np.ndarray, path: Path) -> None:
    normalized = np.clip(heightfield / float(SPEC["dimensions"]["terrain_relief_m"]), 0.0, 1.0)
    gray = np.round(normalized * 65535.0).astype(np.uint16)
    Image.fromarray(gray).save(path)


def main() -> None:
    GENERATED.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    polygon = lake_polygon()
    master_width, master_height = SPEC["grids"]["master"]
    high_width, high_height = SPEC["grids"]["high"]
    low_width, low_height = SPEC["grids"]["low"]
    base_width, base_height = SPEC["grids"]["base"]
    master, master_lake = generate_height(master_width, master_height, polygon)
    high = cv2.resize(master, (high_width, high_height), interpolation=cv2.INTER_AREA)
    high_lake = polygon_mask(high_width, high_height, polygon)
    low = cv2.resize(high, (low_width, low_height), interpolation=cv2.INTER_AREA)
    low_lake = polygon_mask(low_width, low_height, polygon)
    base = cv2.resize(high, (base_width, base_height), interpolation=cv2.INTER_AREA)

    turbines = []
    width_m = float(SPEC["dimensions"]["width_m"])
    depth_m = float(SPEC["dimensions"]["depth_m"])
    base_z = float(SPEC["dimensions"]["base_height_m"])
    for index, (nx, ny) in enumerate(SPEC["reference_targets"]["turbines_normalized"], start=1):
        terrain_z = sample_height(master, nx, ny)
        turbines.append({
            "id": f"{index:02d}",
            "name": f"风机{index:02d}",
            "normalized": [nx, ny],
            "position": [round(nx * width_m * 0.5, 6), round(ny * depth_m * 0.5, 6), round(base_z + terrain_z, 6)],
            "status": ["运行", "待检", "运行"][index - 1],
            "power_kw": [1680, 1420, 1755][index - 1],
        })

    np.savez_compressed(
        GENERATED / "terrain_fields.npz",
        master=master,
        master_lake=master_lake,
        high=high,
        low=low,
        base=base,
        high_lake=high_lake,
        low_lake=low_lake,
    )
    save_height_preview(master, GENERATED / "Terrain_Height_Master.png")
    save_height_preview(high, GENERATED / "Terrain_Height_High.png")
    save_height_preview(low, GENERATED / "Terrain_Height_Low.png")
    preview = np.round(np.clip(master / float(SPEC["dimensions"]["terrain_relief_m"]), 0, 1) * 255).astype(np.uint8)
    Image.fromarray(preview, mode="L").save(GENERATED / "Terrain_Height_Preview.png", optimize=True)

    structure = {
        "asset": SPEC["asset"],
        "dimensions": SPEC["dimensions"],
        "lake": {
            "name": "湖泊",
            "polygon_normalized": polygon,
            "surface_z": SPEC["dimensions"]["lake_surface_m"],
        },
        "turbines": turbines,
        "ridge_groups": 4,
    }
    (GENERATED / "terrain_structure.json").write_text(
        json.dumps(structure, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = {
        "reference_images": 3,
        "reference_resolution": [1536, 1024],
        "terrain_ratio": round(width_m / depth_m, 6),
        "high_grid": [high_width, high_height],
        "master_grid": [master_width, master_height],
        "low_grid": [low_width, low_height],
        "height_min_m": round(float(master.min()), 5),
        "height_max_m": round(float(master.max()), 5),
        "lake_area_ratio_high": round(float(np.count_nonzero(master_lake) / master_lake.size), 6),
        "turbines": turbines,
        "dominant_ridge_groups": 4,
    }
    (REPORTS / "reference_analysis.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
