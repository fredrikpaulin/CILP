#!/bin/bash
set -euo pipefail

# Builds the native Metal bridge (libcopper.dylib) and, once they exist, the ILP
# Metal shaders (copper.metallib). Apple Silicon + Xcode command line tools only.
#
# Adapted from Smith's build.sh, pinned to Smith commit d3327014. Changes: library
# and metallib names, and the shader step is guarded so it is a no-op until the
# shaders land in phase 4 (#014).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 1. Compile the Objective-C Metal bridge.
echo "copper: compiling native bridge..."
clang -O2 -shared -fobjc-arc \
  -framework Metal -framework Foundation \
  -o native/bridge/libcopper.dylib native/bridge/copper_gpu.m

# 2. Compile the Metal shaders, if any exist yet.
shopt -s nullglob
metals=(native/shaders/*.metal)
if [ ${#metals[@]} -gt 0 ]; then
  echo "copper: compiling shaders..."
  for f in "${metals[@]}"; do
    xcrun -sdk macosx metal -O2 -c "$f" -o "${f%.metal}.air"
  done
  xcrun -sdk macosx metallib -o native/shaders/copper.metallib native/shaders/*.air
  rm -f native/shaders/*.air
else
  echo "copper: no shaders yet (they arrive in phase 4)"
fi

echo "copper: build complete"
