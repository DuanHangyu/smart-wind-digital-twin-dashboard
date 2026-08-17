"""Deterministic geometry helpers for the A_CUSTOM_MAP asset.

The module intentionally has no third-party dependencies so it can be imported by
both the workspace Python runtime and Blender's bundled Python interpreter.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Iterable, Sequence

Point = tuple[float, float]
Polygon = list[Point]


def load_spec(path: str | Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def signed_area(poly: Sequence[Point]) -> float:
    return 0.5 * sum(
        poly[i][0] * poly[(i + 1) % len(poly)][1]
        - poly[(i + 1) % len(poly)][0] * poly[i][1]
        for i in range(len(poly))
    )


def area(poly: Sequence[Point]) -> float:
    return abs(signed_area(poly))


def ensure_ccw(poly: Sequence[Point]) -> Polygon:
    result = [(float(x), float(y)) for x, y in poly]
    return result if signed_area(result) > 0 else list(reversed(result))


def centroid(poly: Sequence[Point]) -> Point:
    a = signed_area(poly)
    if abs(a) < 1e-9:
        return (
            sum(p[0] for p in poly) / len(poly),
            sum(p[1] for p in poly) / len(poly),
        )
    cx = 0.0
    cy = 0.0
    for i, p in enumerate(poly):
        q = poly[(i + 1) % len(poly)]
        cross = p[0] * q[1] - q[0] * p[1]
        cx += (p[0] + q[0]) * cross
        cy += (p[1] + q[1]) * cross
    factor = 1.0 / (6.0 * a)
    return cx * factor, cy * factor


def _clip_half_plane(poly: Sequence[Point], a: Point, b: float) -> Polygon:
    """Keep points x for which dot(a, x) <= b."""
    if not poly:
        return []

    def value(p: Point) -> float:
        return a[0] * p[0] + a[1] * p[1] - b

    output: Polygon = []
    previous = poly[-1]
    previous_value = value(previous)
    previous_inside = previous_value <= 1e-9
    for current in poly:
        current_value = value(current)
        current_inside = current_value <= 1e-9
        if current_inside != previous_inside:
            dx = current[0] - previous[0]
            dy = current[1] - previous[1]
            denominator = a[0] * dx + a[1] * dy
            if abs(denominator) > 1e-12:
                t = (b - a[0] * previous[0] - a[1] * previous[1]) / denominator
                output.append((previous[0] + t * dx, previous[1] + t * dy))
        if current_inside:
            output.append(current)
        previous = current
        previous_inside = current_inside
    return output


def voronoi_cells(outer: Sequence[Point], seeds: Sequence[Point]) -> list[Polygon]:
    """Clip the custom outline into deterministic Voronoi cells."""
    boundary = ensure_ccw(outer)
    cells: list[Polygon] = []
    for i, seed in enumerate(seeds):
        cell = list(boundary)
        px, py = seed
        for j, other in enumerate(seeds):
            if i == j:
                continue
            qx, qy = other
            normal = (2.0 * (qx - px), 2.0 * (qy - py))
            threshold = qx * qx + qy * qy - px * px - py * py
            cell = _clip_half_plane(cell, normal, threshold)
            if len(cell) < 3:
                break
        if len(cell) < 3 or area(cell) < 1e-5:
            raise ValueError(f"Seed {i} produced an empty region")
        cells.append(ensure_ccw(cell))
    return cells


def densify(poly: Sequence[Point], max_step: float = 0.30) -> Polygon:
    output: Polygon = []
    for i, start in enumerate(poly):
        end = poly[(i + 1) % len(poly)]
        length = math.hypot(end[0] - start[0], end[1] - start[1])
        segments = max(1, int(math.ceil(length / max_step)))
        for k in range(segments):
            t = k / segments
            output.append(
                (start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t)
            )
    return output


def warp_point(point: Point) -> Point:
    """Apply a shared smooth warp so all adjoining edges remain coincident."""
    x, y = point
    return (
        x + 0.085 * math.sin(1.45 * y) + 0.035 * math.sin(1.8 * x + 0.7 * y),
        y + 0.070 * math.sin(1.15 * x) - 0.030 * math.sin(2.2 * y - 0.4 * x),
    )


def warp_polygon(poly: Sequence[Point], max_step: float = 0.30) -> Polygon:
    return ensure_ccw([warp_point(p) for p in densify(poly, max_step=max_step)])


def scale_about_centroid(poly: Sequence[Point], scale: float) -> Polygon:
    cx, cy = centroid(poly)
    return [(cx + (x - cx) * scale, cy + (y - cy) * scale) for x, y in poly]


def point_in_polygon(point: Point, poly: Sequence[Point]) -> bool:
    x, y = point
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        intersects = (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (
            (yj - yi) or 1e-12
        ) + xi
        if intersects:
            inside = not inside
        j = i
    return inside


def bounds(polygons: Iterable[Sequence[Point]]) -> tuple[float, float, float, float]:
    points = [point for poly in polygons for point in poly]
    return (
        min(p[0] for p in points),
        min(p[1] for p in points),
        max(p[0] for p in points),
        max(p[1] for p in points),
    )


def build_regions(spec: dict, gap: bool = False) -> list[dict]:
    base_cells = voronoi_cells(spec["outer_polygon"], spec["seeds"])
    warped = [warp_polygon(cell) for cell in base_cells]
    if gap:
        warped = [
            scale_about_centroid(poly, spec["dimensions"]["region_gap_scale"])
            for poly in warped
        ]
    regions = []
    for metadata, polygon in zip(spec["regions"], warped, strict=True):
        regions.append(
            {
                **metadata,
                "polygon": [[round(x, 6), round(y, 6)] for x, y in polygon],
                "centroid": [round(v, 6) for v in centroid(polygon)],
                "area": round(area(polygon), 6),
            }
        )
    return regions

