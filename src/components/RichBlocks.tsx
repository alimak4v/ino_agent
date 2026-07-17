import type { ReactNode } from "react";

type RichBlockKind = "matrix" | "vector" | "table" | "proof" | "source_list" | "step_example";

interface MatrixBlock {
  title?: string;
  rows: unknown[][];
  rowLabels?: string[];
  columnLabels?: string[];
  activeRow?: number;
  activeColumn?: number;
  highlightCells?: Array<[number, number]>;
}

interface VectorBlock {
  title?: string;
  values: unknown[];
  labels?: string[];
  orientation?: "row" | "column";
  activeIndex?: number;
}

interface TableBlock {
  title?: string;
  columns?: string[];
  rows: unknown[][];
}

interface ProofStep {
  claim?: string;
  reason?: string;
  expression?: string;
}

interface ProofBlock {
  title?: string;
  steps: ProofStep[];
}

interface SourceItem {
  title?: string;
  target?: string;
  quote?: string;
  page?: string | number;
  score?: string | number;
}

interface SourceListBlock {
  title?: string;
  sources: SourceItem[];
}

interface StepExampleBlock {
  title?: string;
  steps: Array<{
    label?: string;
    expression?: string;
    explanation?: string;
    result?: string;
  }>;
  activeStep?: number;
}

export function richBlockKindFromClass(className?: string): RichBlockKind | null {
  const match = /\blanguage-([a-zA-Z0-9_-]+)/.exec(className ?? "");
  const language = match?.[1]?.toLowerCase().replace(/-/g, "_");
  if (
    language === "matrix" ||
    language === "vector" ||
    language === "table" ||
    language === "proof" ||
    language === "step_example" ||
    language === "stepexample" ||
    language === "source_list" ||
    language === "sources"
  ) {
    if (language === "stepexample") return "step_example";
    return language === "sources" ? "source_list" : language;
  }
  return null;
}

export function RichBlock({
  kind,
  source,
}: {
  kind: RichBlockKind;
  source: string;
}): ReactNode {
  const parsed = parseRichBlock(kind, source);
  if (!parsed) {
    return (
      <pre className="my-4 max-w-full overflow-x-hidden whitespace-pre-wrap break-words rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-4 text-xs leading-relaxed">
        <code>{source}</code>
      </pre>
    );
  }
  if (kind === "matrix") return <MatrixRenderer block={parsed as MatrixBlock} />;
  if (kind === "vector") return <VectorRenderer block={parsed as VectorBlock} />;
  if (kind === "table") return <TableRenderer block={parsed as TableBlock} />;
  if (kind === "proof") return <ProofRenderer block={parsed as ProofBlock} />;
  if (kind === "step_example") return <StepExampleRenderer block={parsed as StepExampleBlock} />;
  return <SourceListRenderer block={parsed as SourceListBlock} />;
}

function MatrixRenderer({ block }: { block: MatrixBlock }) {
  const rows = block.rows;
  const hasColumnLabels = Boolean(block.columnLabels?.length);
  const highlightedCells = new Set((block.highlightCells ?? []).map(([row, column]) => `${row}:${column}`));
  return (
    <section className="my-4 max-w-full overflow-x-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] p-3">
      {block.title && <div className="mb-2 text-sm font-semibold text-[color:var(--text)]">{block.title}</div>}
      <div className="inline-flex items-stretch gap-2">
        <div className="w-2 rounded-l-xl border-y border-l border-[color:var(--muted)]" />
        <table className="border-separate border-spacing-1 text-center text-sm">
          {hasColumnLabels && (
            <thead>
              <tr>
                {block.rowLabels?.length ? <th className="px-2" /> : null}
                {block.columnLabels?.map((label, index) => (
                  <th key={`${label}-${index}`} className="px-2 pb-1 text-[11px] font-medium text-[color:var(--muted)]">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {block.rowLabels?.[rowIndex] && (
                  <th className="pr-2 text-right text-[11px] font-medium text-[color:var(--muted)]">
                    {block.rowLabels[rowIndex]}
                  </th>
                )}
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={`min-w-10 rounded-md px-3 py-1.5 font-mono text-[13px] text-[color:var(--text)] ${
                      highlightedCells.has(`${rowIndex}:${cellIndex}`)
                        ? "bg-amber-500/20 ring-1 ring-amber-400/70"
                        : rowIndex === block.activeRow
                          ? "bg-sky-500/15"
                          : cellIndex === block.activeColumn
                            ? "bg-emerald-500/15"
                            : "bg-[color:var(--panel-soft)]"
                    }`}
                  >
                    {formatCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="w-2 rounded-r-xl border-y border-r border-[color:var(--muted)]" />
      </div>
    </section>
  );
}

function VectorRenderer({ block }: { block: VectorBlock }) {
  const column = block.orientation === "column";
  const cells = block.values.map((value, index) => {
    const active = index === block.activeIndex;
    return (
      <div key={index} className={column ? "flex items-center gap-2" : "space-y-1 text-center"}>
        {block.labels?.[index] && (
          <div className="text-[11px] font-medium text-[color:var(--muted)]">{block.labels[index]}</div>
        )}
        <div
          className={`min-w-10 rounded-md px-3 py-1.5 text-center font-mono text-[13px] text-[color:var(--text)] ${
            active ? "bg-amber-500/20 ring-1 ring-amber-400/70" : "bg-[color:var(--panel-soft)]"
          }`}
        >
          {formatCell(value)}
        </div>
      </div>
    );
  });
  return (
    <section className="my-4 max-w-full overflow-x-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] p-3">
      {block.title && <div className="mb-2 text-sm font-semibold text-[color:var(--text)]">{block.title}</div>}
      <div className={`inline-flex ${column ? "flex-col" : "items-end"} gap-1`}>
        {cells}
      </div>
    </section>
  );
}

function TableRenderer({ block }: { block: TableBlock }) {
  const columns = block.columns ?? [];
  return (
    <section className="my-4 max-w-full overflow-x-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)]">
      {block.title && <div className="border-b border-[color:var(--border)] px-3 py-2 text-sm font-semibold">{block.title}</div>}
      <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
        {columns.length > 0 && (
          <thead className="bg-[color:var(--panel-soft)]">
            <tr>
              {columns.map((column, index) => (
                <th key={`${column}-${index}`} className="border-b border-[color:var(--border)] px-3 py-2 text-xs font-semibold text-[color:var(--muted)]">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody className="divide-y divide-[color:var(--border)]">
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="min-w-[120px] px-3 py-2 align-top text-[color:var(--text)]">
                  {formatCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ProofRenderer({ block }: { block: ProofBlock }) {
  return (
    <section className="my-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] p-3">
      {block.title && <div className="mb-3 text-sm font-semibold text-[color:var(--text)]">{block.title}</div>}
      <ol className="space-y-2">
        {block.steps.map((step, index) => (
          <li key={index} className="grid grid-cols-[28px_minmax(0,1fr)] gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--panel-soft)] text-xs font-semibold text-[color:var(--muted)]">
              {index + 1}
            </div>
            <div className="min-w-0 rounded-lg border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-2">
              {step.claim && <div className="text-sm text-[color:var(--text)]">{step.claim}</div>}
              {step.expression && <div className="mt-1 font-mono text-xs text-[color:var(--text)]">{step.expression}</div>}
              {step.reason && <div className="mt-1 text-xs leading-5 text-[color:var(--muted)]">{step.reason}</div>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SourceListRenderer({ block }: { block: SourceListBlock }) {
  return (
    <section className="my-4 space-y-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] p-3">
      <div className="text-sm font-semibold text-[color:var(--text)]">{block.title || "Sources"}</div>
      {block.sources.map((source, index) => (
        <div key={index} className="rounded-lg border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 truncate text-sm font-medium text-[color:var(--text)]">
              {source.title || source.target || `Source ${index + 1}`}
            </div>
            {source.score !== undefined && (
              <div className="shrink-0 rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
                {source.score}
              </div>
            )}
          </div>
          {source.target && <div className="mt-1 truncate font-mono text-[11px] text-[color:var(--muted)]">{source.target}</div>}
          {source.page !== undefined && <div className="mt-1 text-[11px] text-[color:var(--muted)]">page {source.page}</div>}
          {source.quote && <div className="mt-2 border-l-2 border-[color:var(--border)] pl-2 text-xs leading-5 text-[color:var(--muted)]">{source.quote}</div>}
        </div>
      ))}
    </section>
  );
}

function StepExampleRenderer({ block }: { block: StepExampleBlock }) {
  return (
    <section className="my-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] p-3">
      {block.title && <div className="mb-3 text-sm font-semibold text-[color:var(--text)]">{block.title}</div>}
      <ol className="space-y-2">
        {block.steps.map((step, index) => {
          const active = block.activeStep === index;
          return (
            <li
              key={index}
              className={`grid grid-cols-[32px_minmax(0,1fr)] gap-2 rounded-lg p-1 ${
                active ? "bg-amber-500/10" : ""
              }`}
            >
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  active ? "bg-amber-500/20 text-[color:var(--text)]" : "bg-[color:var(--panel-soft)] text-[color:var(--muted)]"
                }`}
              >
                {step.label || index + 1}
              </div>
              <div className="min-w-0 rounded-lg border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-2">
                {step.expression && <div className="font-mono text-sm text-[color:var(--text)]">{step.expression}</div>}
                {step.explanation && <div className="mt-1 text-xs leading-5 text-[color:var(--muted)]">{step.explanation}</div>}
                {step.result && <div className="mt-2 font-mono text-xs font-semibold text-[color:var(--text)]">{step.result}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function parseRichBlock(kind: RichBlockKind, source: string) {
  const json = parseJson(source);
  if (kind === "matrix") return normalizeMatrix(json ?? parseMatrixText(source));
  if (kind === "vector") return normalizeVector(json ?? parseVectorText(source));
  if (kind === "table") return normalizeTable(json ?? parseDelimitedTable(source));
  if (kind === "proof") return normalizeProof(json);
  if (kind === "step_example") return normalizeStepExample(json);
  return normalizeSourceList(json);
}

function parseJson(source: string): unknown | null {
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function normalizeMatrix(value: unknown): MatrixBlock | null {
  if (Array.isArray(value) && value.every(Array.isArray)) return { rows: value };
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const rows = Array.isArray(object.rows) ? object.rows : Array.isArray(object.matrix) ? object.matrix : null;
  if (!rows || !rows.every(Array.isArray)) return null;
  return {
    title: stringOrUndefined(object.title),
    rows: rows as unknown[][],
    rowLabels: stringArray(object.rowLabels ?? object.row_labels),
    columnLabels: stringArray(object.columnLabels ?? object.column_labels ?? object.columns),
    activeRow: numberOrUndefined(object.activeRow ?? object.active_row),
    activeColumn: numberOrUndefined(object.activeColumn ?? object.active_column),
    highlightCells: cellPairs(object.highlightCells ?? object.highlight_cells),
  };
}

function normalizeVector(value: unknown): VectorBlock | null {
  if (Array.isArray(value)) return { values: value };
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const values = Array.isArray(object.values)
    ? object.values
    : Array.isArray(object.vector)
      ? object.vector
      : null;
  if (!values) return null;
  const orientation = stringOrUndefined(object.orientation);
  return {
    title: stringOrUndefined(object.title),
    values,
    labels: stringArray(object.labels),
    orientation: orientation === "column" ? "column" : "row",
    activeIndex: numberOrUndefined(object.activeIndex ?? object.active_index),
  };
}

function normalizeTable(value: unknown): TableBlock | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const rows = Array.isArray(object.rows) ? object.rows : null;
  if (!rows || !rows.every(Array.isArray)) return null;
  return {
    title: stringOrUndefined(object.title),
    columns: stringArray(object.columns ?? object.headers),
    rows: rows as unknown[][],
  };
}

function normalizeProof(value: unknown): ProofBlock | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const rawSteps = Array.isArray(object.steps) ? object.steps : null;
  if (!rawSteps) return null;
  const steps: ProofStep[] = [];
  for (const step of rawSteps) {
    if (typeof step === "string") {
      steps.push({ claim: step });
      continue;
    }
    if (!step || typeof step !== "object") continue;
      const record = step as Record<string, unknown>;
    const parsed = {
        claim: stringOrUndefined(record.claim ?? record.statement),
        reason: stringOrUndefined(record.reason ?? record.explanation),
        expression: stringOrUndefined(record.expression ?? record.formula),
      };
    if (parsed.claim || parsed.reason || parsed.expression) {
      steps.push(parsed);
    }
  }
  return steps.length ? { title: stringOrUndefined(object.title), steps } : null;
}

function normalizeSourceList(value: unknown): SourceListBlock | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const rawSources = Array.isArray(object.sources) ? object.sources : Array.isArray(object.items) ? object.items : null;
  if (!rawSources) return null;
  const sources: SourceItem[] = [];
  for (const source of rawSources) {
    if (!source || typeof source !== "object") continue;
      const record = source as Record<string, unknown>;
    const parsed = {
        title: stringOrUndefined(record.title),
        target: stringOrUndefined(record.target ?? record.path ?? record.url),
        quote: stringOrUndefined(record.quote ?? record.snippet),
        page: stringOrNumber(record.page),
        score: stringOrNumber(record.score),
      };
    if (parsed.title || parsed.target || parsed.quote) {
      sources.push(parsed);
    }
  }
  return sources.length ? { title: stringOrUndefined(object.title), sources } : null;
}

function normalizeStepExample(value: unknown): StepExampleBlock | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const rawSteps = Array.isArray(object.steps) ? object.steps : null;
  if (!rawSteps) return null;
  const steps = rawSteps
    .map((step): StepExampleBlock["steps"][number] | null => {
      if (typeof step === "string") return { expression: step };
      if (!step || typeof step !== "object") return null;
      const record = step as Record<string, unknown>;
      return {
        label: stringOrUndefined(record.label ?? record.step),
        expression: stringOrUndefined(record.expression ?? record.formula),
        explanation: stringOrUndefined(record.explanation ?? record.reason),
        result: stringOrUndefined(record.result),
      };
    })
    .filter((step): step is StepExampleBlock["steps"][number] =>
      Boolean(step?.label || step?.expression || step?.explanation || step?.result),
    );
  return steps.length
    ? {
        title: stringOrUndefined(object.title),
        steps,
        activeStep: numberOrUndefined(object.activeStep ?? object.active_step),
      }
    : null;
}

function parseMatrixText(source: string): unknown[][] | null {
  const rows = source
    .trim()
    .split(/\n+/)
    .map((line) => line.trim().replace(/^\[|\]$/g, ""))
    .filter(Boolean)
    .map((line) => line.split(/[,\s;]+/).filter(Boolean));
  return rows.length && rows.every((row) => row.length > 0) ? rows : null;
}

function parseVectorText(source: string): unknown[] | null {
  const values = source
    .trim()
    .replace(/^\[|\]$/g, "")
    .split(/[,\s;]+/)
    .filter(Boolean);
  return values.length ? values : null;
}

function parseDelimitedTable(source: string): TableBlock | null {
  const rows = source
    .trim()
    .split(/\n+/)
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((row) => row.length > 1);
  if (!rows.length) return null;
  return { columns: rows[0], rows: rows.slice(1) };
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map((item) => String(item)) : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringOrNumber(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function cellPairs(value: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(value)) return undefined;
  const pairs = value
    .map((item): [number, number] | null => {
      if (!Array.isArray(item) || item.length < 2) return null;
      const row = numberOrUndefined(item[0]);
      const column = numberOrUndefined(item[1]);
      return row === undefined || column === undefined ? null : [row, column];
    })
    .filter((item): item is [number, number] => Boolean(item));
  return pairs.length ? pairs : undefined;
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
