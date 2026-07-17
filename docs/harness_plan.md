# ino-agent Harness Plan

This plan tracks the student-focused agent harness without polluting the global system prompt. Capabilities should be activated through retrieval, context modules, tools, and typed render blocks only when they are relevant.

## Important

- Keep the context window clean: base prompt stays small; memory, knowledge, tool traces, and render contracts are injected dynamically.
- Split `store.rs` responsibilities: persistence remains in `Store`; context assembly, retrieval formatting, and prompt modules live outside it.
- Add permission profiles for agent tools: read-only, workspace-write, command-runner, and explicit dangerous-action approval.
- Add agent modes in UI: normal answer, tool-assisted answer, indexing/memory maintenance, and debug trace.
- Add verifier pass before saving important agent answers: check tool outputs, citations, and whether the answer used unsupported claims.
- Improve automatic memory: durable facts only, no duplicate ingestion, cross-chat shared memory, graph traversal only when the model/tool loop requests it.
- Add production-grade educational render blocks:
  - matrix/vector multiplication with highlighted row, column, and result cell;
  - vectors, coordinate systems, charts, timelines, and small simulations;
  - source cards and citation lists;
  - interactive examples that expose the current step/state without requiring custom HTML from the model.
- Fix production rendering for Mermaid graphs and block diagrams: stable layout, robust syntax normalization, clear error fallback, responsive sizing, and deterministic screenshots/tests.

## Tolerable

- Add reranking for memory/knowledge results after hybrid retrieval.
- Add richer debug views for retrieval: selected memories, graph neighbors, knowledge chunks, final injected context.
- Add compact analytics for feedback: useful/not-useful rates by memory, knowledge chunk, tool, and answer.
- Add file watcher and incremental reindexing queue.
- Add OCR/image descriptions as text-backed memory/knowledge chunks.
- Add render block variants:
  - `vector`;
  - `chart`;
  - `plot`;
  - `timeline`;
  - `diagram`;
  - `step_example`.

## Future

- Learn retrieval weights from feedback/clicks.
- Add external connectors with the same memory/source target abstraction.
- Add long-running task loop with `progress.md`, specs, atomic tasks, and restartable checkpoints.
- Add export/import of memory graph and indexed knowledge.
- Add automated visual QA for all render blocks across desktop and mobile.
