# Demo and Dogfood Scenarios

Use a clean local database for release-candidate dogfood. Record pass/fail notes in
`docs/RELEASE_CHECKLIST.md` before publishing.

Demo data:

- `demo/lecture_linear_algebra.md`
- `demo/research_workspace_notes.md`
- `demo/memory_seed.json`
- `docs/DOGFOOD_REPORT.md`

## 1. Create a Project

Goal: prove that a user can create code from zero and run checks inside ino-agent.

Steps:

1. Open Projects.
2. Create a Python CLI project.
3. Open the generated folder.
4. Run Build, Test, and Run.
5. Ask Agent for the next task.

Pass criteria: files are generated, command output is visible, failures receive a useful diagnosis, and
the agent can inspect the project context.

## 2. Study a Lecture

Goal: prove that the app can explain local learning material with rich visuals.

Steps:

1. Add or index a short Markdown/PDF lecture.
   Suggested source: `demo/lecture_linear_algebra.md`.
2. Ask for an explanation with matrix/vector/chart/Mermaid/graphsteps where relevant.
3. Open the Search page and query a term from the lecture.
4. Run `npm run qa:render-screenshots`.

Pass criteria: answer cites local chunks, render blocks display correctly, and desktop/mobile screenshots pass.

## 3. Find Memory and Run Code

Goal: prove that memory, search, and safe commands work together.

Steps:

1. Save at least three memory items with different confidence/stability values.
   Suggested source: import `demo/memory_seed.json`.
2. Open Memory review and process one suggestion.
3. Export memory JSON.
4. Use Search to find a memory and related local material.
5. Run a safe read/build/test command in Terminal.

Pass criteria: review explains why a memory was remembered, export/import JSON works, Search shows scores and
targets, and Terminal keeps command history.

## 4. Prepare for an Exam

Goal: prove that student-facing workflows are coherent enough for demo.

Steps:

1. Index a small course note set.
2. Ask for a topic map.
3. Ask for a quiz.
4. Ask the agent to plan a revision session as persisted tasks.

Pass criteria: retrieval uses sources, quiz blocks render, and Tasks can continue after app restart.
