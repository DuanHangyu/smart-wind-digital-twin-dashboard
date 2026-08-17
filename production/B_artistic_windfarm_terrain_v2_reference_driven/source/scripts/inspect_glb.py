#!/usr/bin/env python3
"""Validate the production GLB structure, compression and performance budgets."""

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
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "export/B_windfarm_terrain_low_ktx2.glb")
    data = read_json(path)
    nodes = data.get("nodes", [])
    parts = [node for node in nodes if node.get("name", "").startswith("PART__")]
    hotspots = [node for node in nodes if node.get("name", "").startswith("HOTSPOT__")]
    rotors = [node for node in nodes if node.get("name", "").startswith("ROTOR__")]
    triangles = 0
    for mesh in data.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            accessor = primitive.get("indices")
            if accessor is not None:
                triangles += data["accessors"][accessor]["count"] // 3
    required = data.get("extensionsRequired", [])
    report = {
        "path": str(path),
        "file_bytes": path.stat().st_size,
        "nodes": len(nodes),
        "parts": len(parts),
        "hotspots": len(hotspots),
        "rotors": len(rotors),
        "meshes": len(data.get("meshes", [])),
        "materials": len(data.get("materials", [])),
        "triangles": triangles,
        "extensions_used": data.get("extensionsUsed", []),
        "extensions_required": required,
        "mesh_quantized": "KHR_mesh_quantization" in required,
        "basisu": "KHR_texture_basisu" in required,
        "hotspots_target_parts": all(node.get("extras", {}).get("target", "").startswith("PART__") for node in hotspots),
        "budgets": {"triangles": 45000, "file_bytes": 5000000, "parts": 6, "hotspots": 4, "rotors": 3},
    }
    report["pass"] = all([
        report["parts"] == 6,
        report["hotspots"] == 4,
        report["rotors"] == 3,
        report["triangles"] <= 45000,
        report["file_bytes"] <= 5000000,
        report["mesh_quantized"],
        report["basisu"],
        report["hotspots_target_parts"],
    ])
    Path("reports/glb_validation.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
