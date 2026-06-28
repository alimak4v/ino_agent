# treeAI macOS build

## Prerequisites

- macOS 10.15+
- Node.js 20+
- Rust (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- Xcode Command Line Tools

## Build locally on macOS

```bash
cd treeAI-macos-v5
./build_macos.sh
```

The script will create:

```text
dist/treeAI.app
dist/treeAI-mac.dmg
dist/treeAI-mac.dmg.sha256
```

## Run from source (development)

```bash
npm install
npm run tauri:dev
```

## Data locations

- SQLite database: `~/Library/Application Support/treeAI/treeai.sqlite3`
- API key: stored locally in the SQLite settings table
- App icons: generated from `assets/logo.png` via `scripts/make_icon.py`

Do not publish local SQLite databases, `.env` files, built `.app` bundles, or `.dmg` files with source uploads. They are ignored by the project `.gitignore`.

## Notes

- The app is local-first and has no app login.
- Download gating should be done only on the website.
- For a public macOS release, later add Apple code signing and notarization.
- Legacy PySide6 source is preserved in `legacy/` for reference.

## Shortcuts and menu bar icon

- `Cmd+N` creates a new empty Tree.
- A treeAI icon appears in the macOS menu bar while the app is running.
- Menu bar actions: Show treeAI, New Tree, Quit.

## Prompt queue

- While an assistant response is streaming, you can send another prompt; it is queued for the same node.
- After the current response finishes, queued prompts are sent automatically one by one.
- Queued prompts are not persisted across app restarts.
