# Research Workspace Notes

## Topic

Local-first AI tools are useful when users need to keep project files, study notes, and command history on
their own computer. A local agent should clearly show what context it used, what commands it ran, and why it
remembered a fact.

## Constraints

- The app should not upload files unless a model request or user-approved command requires network access.
- Dangerous commands need explicit approval.
- Search results should show source targets, scores, chunks, and related memory.
- Memory cleanup should surface stale, duplicate, low-confidence, or negatively rated entries.

## Demo Queries

```text
What does the research note say about safe command execution?
```

```text
Find local context about memory cleanup and explain why it matters.
```
