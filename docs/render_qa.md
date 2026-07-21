# Render QA

Current smoke checks:

```text
npm run build
npm run qa:render-screenshots
```

These validate TypeScript, Vite bundling, lazy-loaded chat UI, rich render block imports,
Mermaid module imports, and browser screenshots for desktop/mobile viewports.

Manual fixture:

```text
npm run dev:render-smoke
```

The fixture renders matrix/vector/chart/step blocks, plain Mermaid, Mermaid fence directives, graphsteps, and math without requiring a model response.

Automated screenshot coverage:

- desktop viewport: `1280x900`.
- mobile viewport: `390x844`.
- `matrix`, `vector`, `chart`, `step_example`, `mermaid`, Mermaid fence directive, and `graphsteps`.
- graphsteps interaction: advances from step 1 to step 2 before screenshot capture.
- desktop top-bar overlays: Projects, Tasks, Terminal, Search, Memory, and Knowledge must stay inside the viewport.
- screenshots are written to `test-results/render-screenshots/`.

Manual visual targets for follow-up QA:

- Add broader Mermaid samples: sequence diagram, xychart, mindmap, architecture-beta, requirementDiagram, kanban, and C4Context.
- Add a mobile-width chat message fixture with mixed Markdown, math, rich blocks, and graphsteps inside the real chat bubble layout.
