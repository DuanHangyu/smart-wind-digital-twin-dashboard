#!/usr/bin/env python3
"""Validate KTX2 GLB structure, node metadata and web budgets."""
from __future__ import annotations
import json, struct, sys
from pathlib import Path

def read_json(path: Path) -> dict:
    with path.open("rb") as handle:
        magic, version, length = struct.unpack("<III", handle.read(12))
        if magic != 0x46546C67 or version != 2 or length != path.stat().st_size: raise ValueError("Invalid GLB 2.0 header")
        chunk_length, chunk_type = struct.unpack("<II", handle.read(8))
        if chunk_type != 0x4E4F534A: raise ValueError("First GLB chunk is not JSON")
        return json.loads(handle.read(chunk_length).decode("utf-8").rstrip("\0 \t\r\n"))

def main() -> int:
    path=Path(sys.argv[1] if len(sys.argv)>1 else "export/C_dismantlable_turbine_v3_low_ktx2.glb")
    data=read_json(path); nodes=data.get("nodes",[])
    parts=[n for n in nodes if n.get("name","").startswith("PART__")]
    hotspots=[n for n in nodes if n.get("name","").startswith("HOTSPOT__")]
    rotors=[n for n in nodes if n.get("name","").startswith("ROTOR__")]
    triangles=0
    for mesh in data.get("meshes",[]):
        for primitive in mesh.get("primitives",[]):
            accessor=primitive.get("indices")
            triangles += data["accessors"][accessor]["count"]//3 if accessor is not None else 0
    required=data.get("extensionsRequired",[])
    part_extras=all(len(n.get("extras",{}).get("explode_vector",[]))==3 and n.get("extras",{}).get("interactive") for n in parts)
    hotspot_targets={n.get("extras",{}).get("target") for n in hotspots}
    report={
        "path":str(path),"file_bytes":path.stat().st_size,"nodes":len(nodes),"parts":len(parts),"hotspots":len(hotspots),"rotors":len(rotors),
        "meshes":len(data.get("meshes",[])),"materials":len(data.get("materials",[])),"textures":len(data.get("textures",[])),"triangles":triangles,
        "extensions_used":data.get("extensionsUsed",[]),"extensions_required":required,"mesh_quantized":"KHR_mesh_quantization" in required,
        "basisu":"KHR_texture_basisu" in required,"part_metadata_complete":part_extras,
        "hotspot_targets_valid":hotspot_targets.issubset({n.get("name") for n in parts}),
        "budgets":{"triangles":45000,"file_bytes":5000000,"parts":15,"hotspots":9,"rotors":1,"materials_max":2}
    }
    report["pass"]=all([report["parts"]==15,report["hotspots"]==9,report["rotors"]==1,report["triangles"]<=45000,
        report["file_bytes"]<=5000000,report["materials"]<=2,report["mesh_quantized"],report["basisu"],report["part_metadata_complete"],report["hotspot_targets_valid"]])
    Path("reports/glb_validation.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False,indent=2)); return 0 if report["pass"] else 1
if __name__=="__main__": raise SystemExit(main())
