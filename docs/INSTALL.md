# Install

ino-agent is distributed as a local-first Tauri desktop app.

## Development Install

```bash
npm install
npm run tauri:dev
```

## macOS Build

```bash
npm run build
npm run tauri:build
```

If the repository build helper is available, use:

```bash
./build_macos.sh
```

Expected release artifacts are a macOS `.app`, a `.dmg`, and a checksum file. Do not publish local
SQLite databases, `.env` files, API keys, or unsigned experimental artifacts as public releases.

## Clean Profile Smoke Test

Before publishing a release candidate:

1. Move or back up `~/Library/Application Support/ino-agent/ino-agent.sqlite3`.
2. Launch the built app.
3. Confirm first-run onboarding appears.
4. Create a project through the wizard.
5. Run build/test from the app.
6. Run Search and Memory review on demo/local data.
7. Quit and reopen the app, then confirm agent task progress persists.

## Signing Status

Public macOS distribution still needs a final signing/notarization decision. Unsigned builds are useful
for internal dogfood only.
