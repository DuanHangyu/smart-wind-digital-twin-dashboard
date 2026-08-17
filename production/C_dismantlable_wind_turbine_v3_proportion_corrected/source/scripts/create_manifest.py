#!/usr/bin/env python3
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[2]
groups={"blender":"blender/*.blend","glb":"export/*.glb","textures_png":"textures/png/*.png","textures_ktx2":"textures/ktx2/*.ktx2","renders":"renders/*.png","web":"web/**/*","documents":"docs/**/*","reports":"reports/*"}
def record(p):return {"path":str(p.relative_to(ROOT)),"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()}
manifest={k:[record(p) for p in sorted(ROOT.glob(pattern)) if p.is_file() and p.name!="asset_manifest.json"] for k,pattern in groups.items()}
manifest["documents"].append(record(ROOT/"README.md"))
manifest["summary"]={"files":sum(len(v) for v in manifest.values()),"total_bytes":sum(x["bytes"] for v in manifest.values() for x in v)}
(ROOT/"reports/asset_manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps(manifest["summary"],ensure_ascii=False))
