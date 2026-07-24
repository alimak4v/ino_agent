

<img width="1092" height="792" alt="Снимок экрана — 2026-07-24 в 20 06 26" src="https://github.com/user-attachments/assets/863d830c-9f67-4f35-b057-7357e9c11622" />

<p align="center">
  <h1 align="center">ino-agent</h1>
</p>

<p align="center">
  <strong>Local-first AI workspace for students, developers, and researchers.</strong>
</p>

<p align="center">
  ino-agent combines a tree-structured AI chat, long-term memory, local knowledge search,
  project generation, safe command execution, agent task planning, and visual learning blocks
  inside one Tauri desktop app.
</p>

<p align="center">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square">
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square">
  <img alt="Rust" src="https://img.shields.io/badge/Rust-backend-000000?style=flat-square">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-local%20storage-044A64?style=flat-square">
  <img alt="Local first" src="https://img.shields.io/badge/local--first-private-6E56CF?style=flat-square">
</p>

---

## Important

ino-agent is an active release-candidate project. It is built for local development, study,
research, and internal dogfood. Public macOS distribution still needs Developer ID signing and
notarization.

The app stores user data locally. Do not publish local SQLite databases, `.env` files, API keys,
command logs, `.app` bundles, or `.dmg` artifacts from your own machine.

## About

Most AI chats are a single long timeline. That works for quick questions, but breaks down when a
student explores multiple explanations, a developer branches into implementation options, or a
researcher needs to keep sources, decisions, commands, and memory connected.

ino-agent treats the workspace as a tree:

1. A root is a topic, project, lecture, or research thread.
2. Each node is a stable point in the conversation.
3. Child nodes are alternative branches of reasoning.
4. The agent can use local memory, indexed knowledge, project files, and safe tools.
5. Progress is persisted so work can continue after restart.

The goal is not just to answer prompts. The goal is to help users build, learn, debug, search,
remember, and continue work locally.

## Who It Is For

### Students

- Understand lectures, PDFs, notes, and course material.
- Get explanations with math, tables, matrices, vectors, charts, Mermaid diagrams, and graph steps.
- Generate quizzes and step-by-step examples.
- Keep track of weak topics, mistakes, preferences, and exam preparation tasks.
- Search across local notes and past memory.

### Developers

- Create starter projects from scratch.
- Run build, test, and run commands from the app.
- Ask the agent to inspect a project and propose next tasks.
- Break a goal into PRD, specs, and atomic tasks.
- Keep command execution visible and approval-based.

### Researchers

- Build a local research workspace.
- Index local source files and search them with scores and chunks.
- Keep decisions, source notes, hypotheses, and feedback in memory.
- Ask questions with source-grounded answers and related memory.

## Features

### Tree Chat

- Multiple chat trees.
- Branches from any selected node.
- Leaf-only writing to preserve old reasoning paths.
- AI branch planning for broad or multi-part prompts.
- Streaming assistant responses.
- Attachment flow with local PDF text extraction.

### Long-Term Memory

- Shared memory across chats.
- Memory items with title, description, target, source type, tags, importance, confidence,
  stability, and kind.
- Automatic memory extraction.
- Decision log explaining why something was remembered or skipped.
- Memory edit, delete, merge, feedback, and graph debug view.
- Review queue for duplicates, stale items, low-confidence items, and negative feedback.
- Memory export/import as JSON.
- "Why remembered" visibility from the decision log.

### Knowledge Search / RAG

- Local source indexing.
- Knowledge chunks with SQLite metadata.
- Local hashed embedding MVP.
- Hybrid scoring: vector score, keyword score, feedback score, and recency.
- Lightweight reranking.
- Watched paths and reindex controls.
- Retrieval trace in answers.
- Search page with answer, sources, chunks, scores, targets, offsets, open-source actions,
  and related memory.

### Project Wizard

Create a new workspace from inside the app.

Supported project types:

- Python CLI
- Python notebook/research
- C++/CMake
- Rust
- TypeScript/React
- Tauri app
- study notes
- research workspace

Generated projects include README, `.gitignore`, build scripts, tests, starter code, and project
commands. After creation, the user can open the folder, build, run, test, or ask the agent for next
steps.

### Agent Tasks

The agent can work through a goal as persisted tasks:

- create a PRD;
- split it into specs;
- split specs into atomic tasks;
- execute one task at a time;
- store result, error, trace, and progress;
- continue after app restart.

This is the base for a future "complete the whole project" mode.

### Safe Terminal

ino-agent can run workspace commands with safety rules:

- workspace-scoped current directory;
- timeout and max output limits;
- command history;
- repeat command;
- command output in the UI;
- build/test/run diagnostics.

Commands that can delete, overwrite, install packages, access the network, push to Git, or run an
unknown binary require explicit approval.

### Visual Learning Blocks

Assistant messages can render more than plain Markdown:

- Markdown and GFM tables;
- KaTeX math;
- quiz blocks;
- matrix blocks;
- vector blocks;
- chart blocks;
- proof blocks;
- source lists;
- step examples;
- Mermaid diagrams;
- graphsteps with previous/next navigation.

Render blocks are covered by Playwright desktop/mobile screenshot QA.

### Tool and Context Traces

The UI can show:

- tool traces;
- command traces;
- retrieval traces;
- memory decisions;
- permission profile used by the agent.

The user can see what the agent used and what it did.

## How It Works

1. The user creates a chat tree, project, or research workspace.
2. The app stores chat state, memory, settings, command history, and task progress in local SQLite.
3. Local sources can be indexed into knowledge chunks.
4. The agent builds context dynamically from chat, memory, knowledge, render contracts, and tool traces.
5. The user can ask questions, create projects, run commands, search sources, or start an agent task run.
6. Dangerous commands are gated by explicit approval.
7. Memory review keeps long-term memory understandable and maintainable.

## Privacy

ino-agent is local-first.

Default macOS database path:

```text
~/Library/Application Support/ino-agent/ino-agent.sqlite3
```

The local database may contain:

- chat trees and messages;
- model endpoint, model name, and API key;
- memory items and memory decisions;
- indexed source metadata;
- watched local paths;
- command history and output;
- agent task progress.

Network access is needed only for configured model calls or user-approved network commands. See
[Privacy](docs/PRIVACY.md) for details.

## Tech Stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS.
- Desktop shell: Tauri 2.
- Backend: Rust.
- Storage: SQLite through `rusqlite`.
- Graph UI: `@xyflow/react`.
- Markdown: `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`.
- Diagrams: Mermaid.
- QA: Playwright screenshot tests.

## Quick Start

Requirements:

- Node.js 20+
- Rust stable
- Xcode Command Line Tools on macOS
- OpenAI-compatible chat completions endpoint and API key for model-backed actions

Run in development:

```bash
npm install
npm run tauri:dev
```

Frontend-only preview:

```bash
npm run dev
```

Some features only work in the Tauri desktop app because they use native commands, local files,
SQLite, and Tauri `invoke`.

## QA

```bash
cargo check --manifest-path src-tauri/Cargo.toml
npx tsc --noEmit
npm run build
npm run qa:render-screenshots
```

Screenshot QA covers:

- desktop render fixture;
- mobile render fixture;
- matrix/vector/chart/Mermaid/graphsteps;
- top-bar overlay bounds regression.

## Build

Tauri build:

```bash
npm run tauri:build
```

macOS internal release-candidate build:

```bash
bash build_macos.sh
```

The helper creates:

```text
dist/ino-agent.app
dist/ino-agent-mac.dmg
dist/ino-agent-mac.dmg.sha256
```

The current macOS build uses ad-hoc signing for internal RC smoke tests. Public distribution still
needs Developer ID signing and notarization.

## Release Status

Done for release MVP:

- Project wizard.
- Agent loop with tasks/progress.
- Safe command runner UI.
- Search page with sources.
- Memory cleanup/review.
- Render screenshot QA.
- Stable macOS internal RC build.
- First-run onboarding.
- Release docs.

Still open before a public release:

- Manual dogfood on the demo scenarios.
- Developer ID signing and notarization.
- More tests for DB migrations, command safety, agent loop, crash recovery, and memory quality.
- Better OCR, PDF extraction, DOCX/HTML/audio ingestion, and code-aware indexing.

## Documentation

- [Quickstart](docs/QUICKSTART.md)
- [Install](docs/INSTALL.md)
- [Privacy](docs/PRIVACY.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Release technical scope](docs/RELEASE_TZ.md)
- [Demo scenarios](docs/DEMO_SCENARIOS.md)
- [Render QA](docs/render_qa.md)

## Repository Map

```text
src/
  App.tsx                         main desktop UI orchestration
  components/
    ChatPanel.tsx                 chat composer and messages
    TreeCanvas.tsx                tree navigation canvas
    ProjectWizardPanel.tsx        project generator UI
    AgentTasksPanel.tsx           persisted agent task UI
    TerminalPanel.tsx             safe command runner UI
    SearchPanel.tsx               local memory/knowledge search
    MemoryPanel.tsx               memory graph, review, import/export
    KnowledgePanel.tsx            indexing and watched paths
    MarkdownMessage.tsx           markdown, math, rich render blocks
  lib/api.ts                      typed frontend wrapper over Tauri commands

src-tauri/src/
  lib.rs                          Tauri commands and agent orchestration
  store.rs                        SQLite schema, migrations, memory, search, tasks
  api.rs                          OpenAI-compatible chat completions via curl
  project.rs                      project templates and project command runner
  terminal.rs                     safe terminal command assessment and execution
  local_embedding.rs              local hashed embedding MVP
  retrieval_context.rs            retrieval context and trace formatting
```

## License

No public license has been selected yet.
