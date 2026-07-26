# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the React/TypeScript frontend. Put reusable UI in `src/components/`, shared helpers and API/theme code in `src/lib/`, and shared type declarations in `src/types/`.
- `src-tauri/` contains the Rust desktop backend, Tauri configuration, capabilities, and schemas. Keep responsibilities separated by module (for example, persistence in `store.rs` and project operations in `project.rs`).
- `tests/` contains Playwright UI and screenshot tests; `assets/` contains application branding; `demo/` contains sample knowledge/workspace content; `docs/` contains operational and release notes.
- `legacy/` is retained compatibility tooling. Avoid adding new application code there.

## Build, Test, and Development Commands

Run `npm install`, then use:

- `npm run dev` — start the Vite web development server.
- `npm run tauri:dev` — run the complete desktop app locally.
- `npm run build` — type-check TypeScript and produce the Vite production build.
- `cargo check --manifest-path src-tauri/Cargo.toml` — validate Rust compilation quickly.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets` — run Rust lint checks.
- `cargo test --manifest-path src-tauri/Cargo.toml` — run Rust tests.
- `npm run qa:render-screenshots` — run desktop and mobile Playwright render tests; artifacts go under `test-results/`.
- `npm run tauri:build` or `bash build_macos.sh` — build release artifacts.

## Coding Style & Naming Conventions

Use two-space indentation in TypeScript/TSX and the existing double-quoted, semicolon-terminated style. Name React components/files in `PascalCase` (for example, `ChatPanel.tsx`), functions/variables in `camelCase`, and Rust modules/files in `snake_case`. Prefer typed helpers and existing Tailwind utilities. Run the project build and Rust checks before submitting. `cargo fmt --all --check` is informational in CI, but format Rust changes with `cargo fmt --all`.

## Testing Guidelines

Add or update Playwright specs in `tests/` with descriptive names such as `overlay-bounds.spec.ts`. Preserve desktop and mobile coverage for responsive UI, and update screenshot expectations only after reviewing the rendered result. Put backend tests near the relevant Rust module.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects consistent with history, such as `Add ...`, `Fix ...`, or `Bump ...`. Keep commits focused. Pull requests should explain the user-visible change, list validation commands, link an issue or task when available, and include screenshots for visual changes. Call out macOS/Tauri or configuration implications.

## Security & Configuration Tips

Keep the app local-first: do not commit API keys, personal workspace data, generated `test-results/`, or release artifacts. Review Tauri capabilities and command execution changes carefully, especially anything affecting filesystem or terminal access.
