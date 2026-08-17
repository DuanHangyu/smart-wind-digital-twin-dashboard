#!/usr/bin/env python3
"""Measure the web terrain against the deterministic high-resolution master."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[2]
SPEC = json.loads((ROOT / "source/terrain_spec.json").read_text(encoding="utf-8"))
STRUCTURE = json.loads((ROOT / "source/generated/terrain_structure.json").read_text(encoding="utf-8"))
REPORTS = ROOT / "reports"


def main() -> None:
    fields = np.load(ROOT / "source/generated/terrain_fields.npz")
    master = fields["master"].astype(np.float32)
    low = fields["low"].astype(np.float32)
    high_lake = fields["high_lake"] > 0
    upsampled = cv2.resize(low, (master.shape[1], master.shape[0]), interpolation=cv2.INTER_CUBIC)
    relief = float(SPEC["dimensions"]["terrain_relief_m"])
    error = np.abs(master - upsampled) / relief
    front_master = master.max(axis=0) / relief
    front_low = cv2.resize(low.max(axis=0)[None, :], (master.shape[1], 1), interpolation=cv2.INTER_CUBIC)[0] / relief
    side_master = master.max(axis=1) / relief
    side_low = cv2.resize(low.max(axis=1)[:, None], (1, master.shape[0]), interpolation=cv2.INTER_CUBIC)[:, 0] / relief

    yy, xx = np.nonzero(high_lake)
    lake_area = float(high_lake.mean())
    lake_center = [
        float(xx.mean() / (high_lake.shape[1] - 1) * 2 - 1),
        float(1 - yy.mean() / (high_lake.shape[0] - 1) * 2),
    ]
    target_center = SPEC["reference_targets"]["lake_center_normalized"]
    target_area = float(SPEC["reference_targets"]["lake_area_ratio"])
    turbine_error = max(
        float(np.linalg.norm(np.asarray(item["normalized"]) - np.asarray(target)))
        for item, target in zip(STRUCTURE["turbines"], SPEC["reference_targets"]["turbines_normalized"])
    )
    report = {
        "source": "locked procedural master reconstructed from three multiview references",
        "master_grid": [master.shape[1], master.shape[0]],
        "web_grid": [low.shape[1], low.shape[0]],
        "normalized_height_rmse": round(float(np.sqrt(np.mean(np.square((master - upsampled) / relief)))), 6),
        "normalized_height_mae": round(float(error.mean()), 6),
        "normalized_height_p95": round(float(np.percentile(error, 95)), 6),
        "front_silhouette_rmse": round(float(np.sqrt(np.mean(np.square(front_master - front_low)))), 6),
        "side_silhouette_rmse": round(float(np.sqrt(np.mean(np.square(side_master - side_low)))), 6),
        "terrain_aspect": round(float(SPEC["dimensions"]["width_m"] / SPEC["dimensions"]["depth_m"]), 6),
        "lake_area_ratio": round(lake_area, 6),
        "lake_area_error": round(abs(lake_area - target_area), 6),
        "lake_center_normalized": [round(value, 6) for value in lake_center],
        "lake_center_error": round(float(np.linalg.norm(np.asarray(lake_center) - np.asarray(target_center))), 6),
        "turbine_normalized_position_max_error": round(turbine_error, 8),
        "relief_m": round(float(master.max() - master.min()), 6),
        "thresholds": {
            "normalized_height_rmse_max": 0.025,
            "silhouette_rmse_max": 0.035,
            "lake_area_error_max": 0.003,
            "lake_center_error_max": 0.012,
            "turbine_position_error_max": 0.000001,
        },
    }
    report["pass"] = (
        report["normalized_height_rmse"] <= 0.025
        and report["front_silhouette_rmse"] <= 0.035
        and report["side_silhouette_rmse"] <= 0.035
        and report["lake_area_error"] <= 0.003
        and report["lake_center_error"] <= 0.012
        and report["turbine_normalized_position_max_error"] <= 0.000001
    )

    # Red=master, green=web low-poly. Yellow means the two agree.
    master_gray = np.uint8(np.clip(master / relief, 0, 1) * 255)
    low_gray = np.uint8(np.clip(upsampled / relief, 0, 1) * 255)
    overlay = np.dstack([np.zeros_like(master_gray), low_gray, master_gray])
    cv2.imwrite(str(REPORTS / "master_vs_lowpoly_height_overlay.png"), overlay)
    (REPORTS / "fidelity_metrics.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["pass"] else 1)


if __name__ == "__main__":
    main()
