#!/usr/bin/env bash
# Copy only the installers generated on the current platform, and checksum them.
set -euo pipefail
platform="${1:?expected linux, windows or macos}"
case "$platform" in
  linux) root=target/release/bundle; patterns=('*.deb' '*.rpm' '*.AppImage') ;;
  windows) root=target/release/bundle; patterns=('*.msi' '*-setup.exe') ;;
  macos) root=target/universal-apple-darwin/release/bundle; patterns=('*.dmg') ;;
  *) echo "Unsupported platform: $platform" >&2; exit 1 ;;
esac
out="releases/$platform"
mkdir -p "$out"
for pattern in "${patterns[@]}"; do
  found=0
  while IFS= read -r -d '' file; do cp "$file" "$out/"; found=1; done < <(find "$root" -type f -name "$pattern" -print0)
  if [[ "$found" -eq 0 ]]; then echo "Missing installer: $pattern" >&2; exit 1; fi
done
if [[ "$platform" == macos ]]; then
  app="$root/macos/Tervixa Wiggle.app"
  test -d "$app"
  tar -czf "$out/Tervixa-Wiggle-app.tar.gz" -C "$root/macos" 'Tervixa Wiggle.app'
fi
(cd "$out" && python3 - <<'PYHASH'
import hashlib
from pathlib import Path
with open('SHA256SUMS.txt', 'w', encoding='utf-8', newline='\n') as sums:
    for file in sorted(p for p in Path('.').iterdir() if p.is_file() and p.name != 'SHA256SUMS.txt'):
        sums.write(f"{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n")
PYHASH
)
