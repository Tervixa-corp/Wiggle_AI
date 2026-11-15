#!/usr/bin/env bash
# Builds and organizes cross-platform desktop installers & wiggle CLI binaries under releases/.
set -euo pipefail

mode="${1:-auto}"
if [[ "$mode" == "auto" ]]; then
  case "$(uname -s)" in
    Linux*) mode="linux" ;;
    Darwin*) mode="macos" ;;
    MINGW*|MSYS*|CYGWIN*) mode="windows" ;;
    *) echo "Unsupported host OS: $(uname -s)" >&2; exit 1 ;;
  esac
fi

mkdir -p releases/windows releases/linux releases/macos

if [[ "$mode" == "linux" ]]; then
  (cd crates/wiggle-desktop && npx tauri build --bundles deb,rpm,appimage)
  cargo build --release -p wiggle-cli
  cp target/release/wiggle releases/linux/wiggle-linux-x64
  bash scripts/collect-installers.sh linux
elif [[ "$mode" == "windows" ]]; then
  (cd crates/wiggle-desktop && npx tauri build --bundles nsis,msi)
  cargo build --release -p wiggle-cli
  cp target/release/wiggle.exe releases/windows/wiggle-windows-x64.exe
  bash scripts/collect-installers.sh windows
elif [[ "$mode" == "macos" ]]; then
  (cd crates/wiggle-desktop && npx tauri build --target universal-apple-darwin --bundles dmg,app)
  cargo build --release -p wiggle-cli --target aarch64-apple-darwin
  cargo build --release -p wiggle-cli --target x86_64-apple-darwin
  lipo -create \
    target/aarch64-apple-darwin/release/wiggle \
    target/x86_64-apple-darwin/release/wiggle \
    -output releases/macos/wiggle-macos-universal
  bash scripts/collect-installers.sh macos
else
  echo "Usage: $0 [auto|linux|windows|macos]" >&2
  exit 1
fi

(cd releases && python3 - <<'PYHASH'
import hashlib
from pathlib import Path

entries = []
for p in sorted(Path('.').rglob('*')):
    if p.is_file() and p.name != 'SHA256SUMS.txt':
        digest = hashlib.sha256(p.read_bytes()).hexdigest()
        entries.append(f"{digest}  {p.as_posix()}")

Path('SHA256SUMS.txt').write_text('\n'.join(entries) + ('\n' if entries else ''), encoding='utf-8')
PYHASH
)
