import { useEffect, useMemo, useRef, useState } from "react";

let mermaidModule: typeof import("mermaid").default | null = null;
let mermaidInitialized = false;
let renderSequence = 0;

interface GraphStep {
  step: number | string;
  description: string;
  graph: string;
}

async function getMermaid() {
  if (!mermaidModule) {
    mermaidModule = (await import("mermaid")).default;
  }
  if (mermaidInitialized) return mermaidModule;
  mermaidModule.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      background: "transparent",
      primaryColor: "#ffffff",
      primaryTextColor: "#202124",
      primaryBorderColor: "#d8d8d8",
      lineColor: "#777777",
      secondaryColor: "#f7f7f7",
      tertiaryColor: "#f2f2f2",
      fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    },
  });
  mermaidInitialized = true;
  return mermaidModule;
}

export function MermaidDiagram({ graph }: { graph: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const normalizedGraph = useMemo(() => normalizeMermaidGraph(graph), [graph]);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      try {
        const mermaid = await getMermaid();
        const id = `treeai-mermaid-${renderSequence++}`;
        const result = await mermaid.render(id, normalizedGraph);
        if (!cancelled) {
          setSvg(result.svg);
          setError("");
        }
      } catch (e) {
        if (!cancelled) {
          setSvg("");
          setError(formatError(e));
        }
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [normalizedGraph]);

  if (error) {
    return (
      <div className="my-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700">
        Mermaid graph error: {error}
      </div>
    );
  }

  return (
    <div className="my-4 w-full min-w-0 overflow-x-auto rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] p-4">
      {svg ? (
        <div
          className="mermaid-svg mx-auto flex min-h-[180px] w-full min-w-0 items-center justify-center [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="text-sm text-[color:var(--muted)]">Rendering graph</div>
      )}
    </div>
  );
}

export function GraphSteps({ source }: { source: string }) {
  const steps = useMemo(() => parseGraphSteps(source), [source]);
  const [index, setIndex] = useState(0);
  const previousLength = useRef(steps.length);

  useEffect(() => {
    if (previousLength.current !== steps.length) {
      previousLength.current = steps.length;
      setIndex(0);
    }
  }, [steps.length]);

  if (steps.length === 0) {
    return (
      <div className="my-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700">
        Could not read graph steps. Use a JSON array with step, description and graph fields.
      </div>
    );
  }

  const current = steps[Math.min(index, steps.length - 1)];

  return (
    <div className="my-5 w-full min-w-0 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border)] px-3 py-2">
        <div className="min-w-0 text-sm font-medium text-[color:var(--text)]">
          Step {current.step} · {index + 1} / {steps.length}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => setIndex((value) => Math.max(0, value - 1))}
            className="inline-flex h-8 items-center rounded-full border border-[color:var(--border)] px-3 text-xs text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)] disabled:cursor-not-allowed disabled:opacity-35"
          >
            ← Назад
          </button>
          <button
            type="button"
            disabled={index === steps.length - 1}
            onClick={() => setIndex((value) => Math.min(steps.length - 1, value + 1))}
            className="inline-flex h-8 items-center rounded-full border border-[color:var(--border)] px-3 text-xs text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)] disabled:cursor-not-allowed disabled:opacity-35"
          >
            Вперед →
          </button>
        </div>
      </div>
      <div className="px-4 pb-4 pt-3">
        <div className="mb-3 min-h-[48px] text-sm leading-6 text-[color:var(--text)]">
          {current.description}
        </div>
        <div className="min-h-[240px] w-full min-w-0">
          <MermaidDiagram graph={current.graph} />
        </div>
      </div>
    </div>
  );
}

function parseGraphSteps(source: string): GraphStep[] {
  try {
    const parsed = JSON.parse(source.trim());
    const items = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { steps?: unknown }).steps)
        ? (parsed as { steps: unknown[] }).steps
        : [];
    return items
      .map((item: unknown, index: number) => normalizeStep(item, index))
      .filter((step): step is GraphStep => Boolean(step))
      .slice(0, 24);
  } catch {
    return [];
  }
}

function normalizeStep(item: unknown, index: number): GraphStep | null {
  if (!item || typeof item !== "object") return null;
  const value = item as Record<string, unknown>;
  const graph = typeof value.graph === "string" ? value.graph.trim() : "";
  if (!graph) return null;
  const description =
    typeof value.description === "string" && value.description.trim()
      ? value.description.trim()
      : `Step ${index + 1}`;
  const step =
    typeof value.step === "number" || typeof value.step === "string"
      ? value.step
      : index + 1;
  return { step, description, graph };
}

function normalizeMermaidGraph(graph: string) {
  return graph
    .trim()
    .replace(/--\|([^|\n]+)\|>/g, "-->|$1|")
    .replace(/--\|([^|\n]+)\|-/g, "-->|$1|")
    .replace(/==\|([^|\n]+)\|>/g, "==>|$1|")
    .replace(/-\.\|([^|\n]+)\|>/g, "-.->|$1|")
    .split("\n")
    .map(normalizeMermaidLine)
    .join("\n");
}

function normalizeMermaidLine(line: string) {
  const edge = line.match(/^(\s*)([A-Za-z0-9_]+(?:\([^)]*\)|\[[^\]]*\]|\{[^}]*\})?)\s+<--+\s+([A-Za-z0-9_]+(?:\([^)]*\)|\[[^\]]*\]|\{[^}]*\})?)(\s*)$/);
  if (!edge) return line;
  return `${edge[1]}${edge[3]} --> ${edge[2]}${edge[4]}`;
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
