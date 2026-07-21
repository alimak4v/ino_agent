# Quickstart

This guide is for running ino-agent locally during development and release smoke tests.

## Requirements

- macOS with Xcode Command Line Tools.
- Node.js 20+.
- Rust stable.
- An OpenAI-compatible chat completions endpoint and API key for model-backed agent actions.

## Start the app

```bash
npm install
npm run tauri:dev
```

The web preview can be started with `npm run dev`, but project creation, commands, local file access,
memory, and search are desktop/Tauri features.

## First checks

1. Create a new tree.
2. Open Settings and save endpoint/model/API key.
3. Open Projects, create a small Python CLI project, then run Build/Test/Run.
4. Open Terminal and run a safe command such as `ls`.
5. Add or search a memory from the Memory panel.
6. Open Search and query indexed memory/knowledge.

## QA commands

```bash
cargo check --manifest-path src-tauri/Cargo.toml
npx tsc --noEmit
npm run build
npm run qa:render-screenshots
```

`npm run qa:render-screenshots` uses Playwright and writes ignored screenshots to
`test-results/render-screenshots/`.
