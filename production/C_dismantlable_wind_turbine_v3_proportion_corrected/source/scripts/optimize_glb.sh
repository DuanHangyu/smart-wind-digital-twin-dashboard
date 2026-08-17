#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RAW="$ROOT/export/C_dismantlable_turbine_v3_low_raw.glb"
QUANTIZED="$ROOT/export/C_dismantlable_turbine_v3_low_quantized.glb"
NORMAL="$ROOT/export/C_dismantlable_turbine_v3_low_normal_uastc.glb"
UASTC="$ROOT/export/C_dismantlable_turbine_v3_low_uastc.glb"
FINAL="$ROOT/export/C_dismantlable_turbine_v3_low_ktx2.glb"
UNPACK="$ROOT/export/unpacked"
KTX_ROOT="${KTX_RUNTIME_DIR:-$ROOT/tooling/ktx-runtime}"
KTX_BIN="$KTX_ROOT/bin"
KTX_LIB="$KTX_ROOT/lib"

if [[ ! -x "$KTX_BIN/ktx" || ! -x "$KTX_BIN/toktx" ]]; then
  echo "KTX runtime not found under $KTX_BIN" >&2
  exit 1
fi

export PATH="$KTX_BIN:$PATH"
export DYLD_LIBRARY_PATH="$KTX_LIB${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
cd "$ROOT"

npx gltf-transform quantize "$RAW" "$QUANTIZED" \
  --quantization-volume scene --quantize-position 16 --quantize-normal 10 --quantize-texcoord 12
npx gltf-transform uastc "$QUANTIZED" "$NORMAL" \
  --slots normalTexture --level 2 --rdo --rdo-lambda 0.5 --zstd 15 --jobs 4
npx gltf-transform uastc "$NORMAL" "$UASTC" \
  --pattern "C_Turbine_ORM" --level 2 --rdo --rdo-lambda 0.5 --zstd 15 --jobs 4
npx gltf-transform etc1s "$UASTC" "$FINAL" \
  --slots baseColorTexture --quality 210 --compression 2 --jobs 4

mkdir -p "$UNPACK" "$ROOT/textures/ktx2" "$ROOT/web/public/models"
npx gltf-transform copy "$FINAL" "$UNPACK/C_dismantlable_turbine.gltf"
find "$UNPACK" -type f -name '*.ktx2' -exec cp {} "$ROOT/textures/ktx2/" \;
cp "$FINAL" "$ROOT/web/public/models/C_dismantlable_turbine_v3_low_ktx2.glb"
npx gltf-transform inspect "$FINAL"
