import { useEffect } from "react";
import { applyThemeVars, THEMES } from "../lib/theme";
import { MarkdownMessage } from "./MarkdownMessage";

const FENCE = "```";
const SMOKE_MARKDOWN = [
  "# Render smoke",
  "",
  String.raw`Inline math: \(C_{ij}=\sum_k A_{ik}B_{kj}\).`,
  "",
  `${FENCE}matrix`,
  '{"title":"A row highlighted","rows":[[2,1,3],[4,0,2]],"rowLabels":["r1","r2"],"columnLabels":["c1","c2","c3"],"activeRow":0,"highlightCells":[[0,0],[0,1],[0,2]]}',
  FENCE,
  "",
  `${FENCE}vector`,
  '{"title":"B column","values":[2,4,7],"labels":["k=1","k=2","k=3"],"orientation":"column","activeIndex":2}',
  FENCE,
  "",
  `${FENCE}chart`,
  '{"title":"Loss by iteration","type":"line","xLabel":"iteration","yLabel":"loss","activeIndex":2,"series":[{"label":"train","points":[[1,1.0],[2,0.42],[3,0.28],[4,0.21]]},{"label":"validation","points":[[1,1.1],[2,0.58],[3,0.36],[4,0.33]]}]}',
  FENCE,
  "",
  `${FENCE}step_example`,
  '{"title":"Matrix product cell","activeStep":2,"steps":[{"label":"1","expression":"2 * 2","explanation":"first row times first column"},{"label":"2","expression":"1 * 4"},{"label":"3","expression":"3 * 7","result":"29"}]}',
  FENCE,
  "",
  `${FENCE}mermaid`,
  "flowchart LR",
  "  Query --> Retrieve",
  "  Retrieve --> Rerank",
  "  Rerank --> Answer",
  FENCE,
  "",
  `${FENCE}block-beta`,
  "columns 3",
  '  A["Prompt"] B["Context"] C["Tools"]',
  '  D["Answer"]:3',
  FENCE,
  "",
  `${FENCE}graphsteps`,
  "[",
  '  {"step":1,"description":"Start with the query.","graph":"flowchart LR\\nQ[Query] --> R[Retrieve]"},',
  '  {"step":2,"description":"Rerank candidates.","graph":"flowchart LR\\nQ[Query] --> R[Retrieve]\\nR --> K[Rerank]"},',
  '  {"step":3,"description":"Assemble context.","graph":"flowchart LR\\nQ[Query] --> R[Retrieve]\\nR --> K[Rerank]\\nK --> C[Context]"},',
  '  {"step":4,"description":"Generate answer.","graph":"flowchart LR\\nQ[Query] --> R[Retrieve]\\nR --> K[Rerank]\\nK --> C[Context]\\nC --> A[Answer]"}',
  "]",
  FENCE,
].join("\n");

export function RenderSmoke() {
  useEffect(() => {
    applyThemeVars(THEMES["Minimal Light"]);
  }, []);

  return (
    <main
      data-testid="render-smoke"
      className="min-h-screen bg-[color:var(--app-bg)] px-4 py-6 text-[color:var(--text)]"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.08)]">
        <div className="mb-4 border-b border-[color:var(--border)] pb-3">
          <div className="text-sm font-semibold">Render QA Fixture</div>
          <div className="mt-1 text-xs text-[color:var(--muted)]">
            Open with <code>/?renderSmoke=1</code> while running Vite.
          </div>
        </div>
        <MarkdownMessage content={SMOKE_MARKDOWN} />
      </div>
    </main>
  );
}
