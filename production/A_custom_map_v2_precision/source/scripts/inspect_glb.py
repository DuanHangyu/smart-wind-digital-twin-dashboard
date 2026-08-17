#!/usr/bin/env python3
"""Validate the final precision GLB without third-party Python packages."""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path


def read_json(path: Path) -> dict:
    with path.open("rb") as handle:
        magic, version, length = struct.unpack("<III", handle.read(12))
        if magic != 0x46546C67 or version != 2 or length != path.stat().st_size:
            raise ValueError("Invalid GLB 2.0 header")
        chunk_length, chunk_type = struct.unpack("<II", handle.read(8))
        if chunk_type != 0x4E4F534A:
            raise ValueError("First chunk is not JSON")
        return json.loads(handle.read(chunk_length).decode("utf-8").rstrip("\0 \t\r\n"))


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "export/A_custom_map_v2_low_ktx2.glb")
    data = read_json(path)
    nodes = data.get("nodes", [])
    parts = [node for node in nodes if node.get("name", "").startswith("PART__")]
    hotspots = [node for node in nodes if node.get("name", "").startswith("HOTSPOT__")]
    outlines = [node for node in nodes if node.get("name", "").startswith("FX__OUTLINE_")]
    triangles = 0
    for mesh in data.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            accessor = primitive.get("indices")
            if accessor is not None:
                triangles += data["accessors"][accessor]["count"] // 3
    report = {
        "path": str(path), "file_bytes": path.stat().st_size,
        "nodes": len(nodes), "parts": len(parts), "hotspots": len(hotspots),
        "outline_nodes": len(outlines), "meshes": len(data.get("meshes", [])),
        "materials": len(data.get("materials", [])), "triangles": triangles,
        "extensions_used": data.get("extensionsUsed", []),
        "extensions_required": data.get("extensionsRequired", []),
        "mesh_quantized": "KHR_mesh_quantization" in data.get("extensionsRequired", []),
        "all_parts_interactive": all(node.get("extras", {}).get("interactive") for node in parts),
        "all_hotspots_target_parts": all(node.get("extras", {}).get("target", "").startswith("PART__") for node in hotspots),
    }
    checks = [
        report["parts"] == 14, report["hotspots"] == 14, report["outline_nodes"] == 14,
        report["triangles"] <= 30_000, report["file_bytes"] <= 2_500_000,
        "KHR_texture_basisu" in report["extensions_required"],
        report["mesh_quantized"],
        report["all_parts_interactive"], report["all_hotspots_target_parts"],
    ]
    report["pass"] = all(checks)
    report_path = Path("reports/glb_validation.json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        f"{json.dumps(report, ensure_ascii=False, indent=2)}\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
