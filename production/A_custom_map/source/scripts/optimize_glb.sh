#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RAW_GLB="$PROJECT_ROOT/export/A_custom_map_low_raw.glb"
NORMAL_GLB="$PROJECT_ROOT/export/A_custom_map_low_normal_uastc.glb"
UASTC_GLB="$PROJECT_ROOT/export/A_custom_map_low_uastc.glb"
FINAL_GLB="$PROJECT_ROOT/export/A_custom_map_low_ktx2.glb"
UNPACK_DIR="$PROJECT_ROOT/export/unpacked"
KTX_BIN="$PROJECT_ROOT/tooling/ktx-runtime/bin"
KTX_LIB="$PROJECT_ROOT/tooling/ktx-runtime/lib"

if [[ ! -x "$KTX_BIN/toktx" ]]; then
  echo "toktx not found at: $KTX_BIN/toktx" >&2
  exit 1
fi

export PATH="$KTX_BIN:$PATH"
export DYLD_LIBRARY_PATH="$KTX_LIB${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
cd "$PROJECT_ROOT"

# Data maps preserve higher-frequency tangent/occlusion information with UASTC.
# Separate passes avoid CLI comma-list parsing and still retain prior KTX2 textures.
npx gltf-transform uastc "$RAW_GLB" "$NORMAL_GLB" \
  --slots normalTexture \
  --level 2 --rdo --rdo-lambda 0.5 --zstd 15 --jobs 4
npx gltf-transform uastc "$NORMAL_GLB" "$UASTC_GLB" \
  --slots occlusionTexture \
  --level 2 --rdo --rdo-lambda 0.5 --zstd 15 --jobs 4

# Color maps use ETC1S for compact delivery. The emissive slot reuses Base Color.
npx gltf-transform etc1s "$UASTC_GLB" "$FINAL_GLB" \
  --slots baseColorTexture \
  --quality 200 --compression 2 --jobs 4

mkdir -p "$UNPACK_DIR" "$PROJECT_ROOT/textures/ktx2" "$PROJECT_ROOT/web/public/models"
npx gltf-transform copy "$FINAL_GLB" "$UNPACK_DIR/A_custom_map.gltf"
find "$UNPACK_DIR" -type f -name '*.ktx2' -exec cp {} "$PROJECT_ROOT/textures/ktx2/" \;
cp "$FINAL_GLB" "$PROJECT_ROOT/web/public/models/A_custom_map_low_ktx2.glb"

npx gltf-transform inspect "$FINAL_GLB"
