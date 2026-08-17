#!/usr/bin/env python3
"""Create a reproducible manifest for the final B terrain deliverables."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PATTERNS = [
    "blender/B0[1-8]_*.blend",
    "renders/B08*.png",
    "textures/png/Terrain_*.png",
    "textures/ktx2/*.ktx2",
    "export/B_windfarm_terrain_low_ktx2.glb",
    "source/terrain_spec.json",
    "source/scripts/*.py",
    "source/scripts/*.sh",
    "web/index.html",
    "web/src/*.js",
    "web/src/*.css",
    "reports/*.json",
    "reports/turbine_*three_views.png",
    "docs/*.md",
]


def main() -> None:
    manifest_path = ROOT / "reports/asset_manifest.json"
    paths = sorted({
        path for pattern in PATTERNS for path in ROOT.glob(pattern)
        if path.is_file() and path != manifest_path
    })
    files = []
    for path in paths:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        files.append({"path": str(path.relative_to(ROOT)), "bytes": path.stat().st_size, "sha256": digest})
    manifest = {
        "asset": "B_ARTISTIC_WINDFARM_TERRAIN_V3_TURBINE_REFINED",
        "version": "3.0.0",
        "files": files,
        "file_count": len(files),
        "total_bytes": sum(item["bytes"] for item in files),
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({key: manifest[key] for key in ("asset", "version", "file_count", "total_bytes")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
