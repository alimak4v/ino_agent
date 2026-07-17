import { useEffect, useMemo, useRef, useState } from "react";

let mermaidModule: typeof import("mermaid").default | null = null;
let mermaidInitialized = false;
let renderSequence = 0;

interface GraphStep {
  step: number | string;
  description: string;
  graph: string;
}

const MERMAID_START_RE =
  /^(flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|gitGraph|pie|xychart(?:-beta)?|timeline|gantt|mindmap|journey|quadrantChart|sankey(?:-beta)?|block-beta|blockDiagram|architecture(?:-beta)?|requirementDiagram|kanban|packet|C4Context|C4Container|C4Component|C4Dynamic)\b/;

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
      <div className="my-4 overflow-hidden rounded-xl border border-red-200 bg-red-50 text-xs leading-5 text-red-700">
        <div className="px-4 py-3">Mermaid graph error: {error}</div>
        <details className="border-t border-red-200">
          <summary className="cursor-pointer px-4 py-2 font-medium">Normalized source</summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-4 pb-3 font-mono text-[11px]">
            {normalizedGraph}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div className="my-4 w-full min-w-0 overflow-x-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] p-4">
      {svg ? (
        <div
          className="mermaid-svg mx-auto flex min-h-[220px] w-full min-w-[320px] items-center justify-center [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-h-[720px] [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="flex min-h-[220px] items-center justify-center text-sm text-[color:var(--muted)]">
          Rendering graph
        </div>
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

export function looksLikeGraphStepsSource(source: string) {
  return parseGraphSteps(source).length > 0;
}

function normalizeStep(item: unknown, index: number): GraphStep | null {
  if (!item || typeof item !== "object") return null;
  const value = item as Record<string, unknown>;
  const rawGraph =
    typeof value.graph === "string"
      ? value.graph
      : typeof value.mermaid === "string"
        ? value.mermaid
        : typeof value.diagram === "string"
          ? value.diagram
          : "";
  const graph = normalizeMermaidGraph(rawGraph);
  if (!looksLikeMermaidGraphSource(graph)) return null;
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

export function looksLikeMermaidGraphSource(graph: string) {
  const firstLine = graph.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  return MERMAID_START_RE.test(firstLine);
}

function normalizeMermaidGraph(graph: string) {
  return stripCodeFence(graph)
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/--\|([^|\n]+)\|>/g, "-->|$1|")
    .replace(/--\|([^|\n]+)\|-/g, "-->|$1|")
    .replace(/==\|([^|\n]+)\|>/g, "==>|$1|")
    .replace(/-\.\|([^|\n]+)\|>/g, "-.->|$1|")
    .split("\n")
    .map(normalizeMermaidLine)
    .join("\n")
    .trim();
}

function normalizeMermaidLine(line: string) {
  const labelledReverse = line.match(
    /^(\s*)([A-Za-z0-9_-]+(?:\([^)]*\)|\[[^\]]*\]|\{[^}]*\})?)\s+<--+\|([^|\n]+)\|\s+([A-Za-z0-9_-]+(?:\([^)]*\)|\[[^\]]*\]|\{[^}]*\})?)(\s*)$/,
  );
  if (labelledReverse) {
    return `${labelledReverse[1]}${labelledReverse[4]} -->|${labelledReverse[3]}| ${labelledReverse[2]}${labelledReverse[5]}`;
  }
  const reverse = line.match(
    /^(\s*)([A-Za-z0-9_-]+(?:\([^)]*\)|\[[^\]]*\]|\{[^}]*\})?)\s+<--+\s+([A-Za-z0-9_-]+(?:\([^)]*\)|\[[^\]]*\]|\{[^}]*\})?)(\s*)$/,
  );
  if (reverse) return `${reverse[1]}${reverse[3]} --> ${reverse[2]}${reverse[4]}`;
  const unicodeArrow = line.match(
    /^(\s*)([A-Za-z0-9_-]+(?:\([^)]*\)|\[[^\]]*\]|\{[^}]*\})?)\s*(?:→|➡)\s*([A-Za-z0-9_-]+(?:\([^)]*\)|\[[^\]]*\]|\{[^}]*\})?)(\s*)$/,
  );
  if (unicodeArrow) return `${unicodeArrow[1]}${unicodeArrow[2]} --> ${unicodeArrow[3]}${unicodeArrow[4]}`;
  return line;
}

function stripCodeFence(source: string) {
  const trimmed = source.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 2) return trimmed;
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim().startsWith("```"));
  if (closingIndex === -1) return lines.slice(1).join("\n").trim();
  return lines.slice(1, closingIndex).join("\n").trim();
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
