# Render QA

Current smoke check:

```text
npm run build
```

This validates TypeScript, Vite bundling, lazy-loaded chat UI, rich render block imports, and Mermaid module imports.

Manual fixture:

```text
npm run dev
open http://localhost:5173/?renderSmoke=1
```

The fixture renders matrix/vector/chart/step blocks, plain Mermaid, Mermaid fence directives, graphsteps, and math without requiring a model response.

Manual visual targets for the next QA pass:

- `matrix` with `activeRow`, `activeColumn`, and `highlightCells`.
- `vector` in row and column orientation.
- `step_example` with active step and result.
- static `mermaid` flowchart, sequence diagram, xychart, and mindmap.
- Mermaid fence directives without `mermaid` wrapper: `block-beta`, `architecture-beta`, `requirementDiagram`, `kanban`, and `C4Context`.
- `graphsteps` with at least five steps and changing highlighted graph state.
- mobile-width chat message containing mixed Markdown, math, rich blocks, and graphsteps.

Known gap:

- Browser screenshot automation was not available in this session, so this pass is build-level/manual-fixture QA. The next production QA step should add screenshot checks for desktop and mobile widths.
