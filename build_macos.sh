#!/usr/bin/env bash
set -euo pipefail

APP_NAME="ino-agent"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This macOS build script must be run on macOS."
  exit 1
fi

source "$HOME/.cargo/env" 2>/dev/null || true

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node 20+."
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust is required. Install via: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  exit 1
fi

mkdir -p assets
if [[ -f "assets/new_logo.png" && ! -f "assets/logo.png" ]] || [[ "assets/new_logo.png" -nt "assets/logo.png" ]]; then
  cp assets/new_logo.png assets/logo.png
fi

if [[ ! -f "assets/logo.png" ]]; then
  echo "Missing assets/logo.png"
  exit 1
fi

python3 scripts/make_icon.py

npm install
npm run tauri -- build --bundles app

APP_PATH="src-tauri/target/release/bundle/macos/${APP_NAME}.app"
if [[ ! -d "$APP_PATH" ]]; then
  APP_PATH=$(find src-tauri/target/release/bundle/macos -name "*.app" -type d | head -1)
fi

if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  codesign --force --deep --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$APP_PATH"
else
  codesign --force --deep --sign - "$APP_PATH"
fi
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

mkdir -p dist
rm -rf "dist/${APP_NAME}.app"
cp -R "$APP_PATH" "dist/${APP_NAME}.app"
rm -f "dist/${APP_NAME}-mac.dmg" "dist/${APP_NAME}-mac.dmg.sha256"

rm -rf dmg-root
mkdir -p dmg-root
cp -R "dist/${APP_NAME}.app" dmg-root/
ln -sf /Applications dmg-root/Applications
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder dmg-root \
  -ov \
  -format UDZO \
  "dist/${APP_NAME}-mac.dmg"

shasum -a 256 "dist/${APP_NAME}-mac.dmg" > "dist/${APP_NAME}-mac.dmg.sha256"

echo "Built: dist/${APP_NAME}.app"
echo "Built: dist/${APP_NAME}-mac.dmg"
echo "Checksum: dist/${APP_NAME}-mac.dmg.sha256"
