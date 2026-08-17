#!/usr/bin/env python3
"""Dependency-free structural validation for the delivery GLB."""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path


def load_glb_json(path: Path) -> dict:
    with path.open("rb") as handle:
        magic, version, length = struct.unpack("<III", handle.read(12))
        if magic != 0x46546C67 or version != 2 or length != path.stat().st_size:
            raise ValueError("Invalid GLB 2.0 header or declared length")
        chunk_length, chunk_type = struct.unpack("<II", handle.read(8))
        if chunk_type != 0x4E4F534A:
            raise ValueError("First GLB chunk is not JSON")
        return json.loads(handle.read(chunk_length).decode("utf-8").rstrip("\0 \t\r\n"))


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "export/A_custom_map_low_ktx2.glb")
    data = load_glb_json(path)
    nodes = data.get("nodes", [])
    parts = [node for node in nodes if node.get("name", "").startswith("PART__")]
    hotspots = [node for node in nodes if node.get("name", "").startswith("HOTSPOT__")]
    meshes = data.get("meshes", [])
    triangles = 0
    for mesh in meshes:
        for primitive in mesh.get("primitives", []):
            accessor_index = primitive.get("indices")
            if accessor_index is not None:
                triangles += data["accessors"][accessor_index]["count"] // 3
    report = {
        "path": str(path),
        "file_bytes": path.stat().st_size,
        "nodes": len(nodes),
        "parts": len(parts),
        "hotspots": len(hotspots),
        "meshes": len(meshes),
        "materials": len(data.get("materials", [])),
        "triangles": triangles,
        "extensions_used": data.get("extensionsUsed", []),
        "extensions_required": data.get("extensionsRequired", []),
        "all_parts_interactive": all(node.get("extras", {}).get("interactive") for node in parts),
        "all_hotspots_target_parts": all(
            node.get("extras", {}).get("target", "").startswith("PART__") for node in hotspots
        ),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    checks = [
        report["parts"] == 14,
        report["hotspots"] == 14,
        report["triangles"] <= 12_000,
        report["file_bytes"] <= 1_500_000,
        "KHR_texture_basisu" in report["extensions_required"],
        report["all_parts_interactive"],
        report["all_hotspots_target_parts"],
    ]
    return 0 if all(checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
