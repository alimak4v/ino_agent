import { type FormEvent, useState } from "react";
import { api, type KnowledgeSearchResult, type MemorySearchResult, type SearchPageResult } from "../lib/api";

interface SearchPanelProps {
  onClose: () => void;
  onOpenTarget: (target: string) => Promise<void>;
}

type SearchTab = "sources" | "chunks" | "memory";

export function SearchPanel({ onClose, onOpenTarget }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(10);
  const [result, setResult] = useState<SearchPageResult | null>(null);
  const [tab, setTab] = useState<SearchTab>("sources");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await api.searchPage(trimmed, limit);
      setResult(next);
      setTab("sources");
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const sourceGroups = groupBySource(result?.knowledgeResults ?? []);

  return (
    <aside className="no-drag fixed left-3 right-3 top-12 z-50 max-h-[calc(100vh-64px)] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)]/95 shadow-[0_12px_40px_rgba(0,0,0,0.14)] backdrop-blur-xl lg:left-auto lg:right-3 lg:w-[900px]">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[color:var(--text)]">Search</div>
          <div className="truncate text-xs text-[color:var(--muted)]">
            Answer, sources, chunks and related memory
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-8 rounded-full px-3 text-xs text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)]"
        >
          Close
        </button>
      </div>

      <div className="grid max-h-[calc(100vh-122px)] gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          <form onSubmit={submit} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px]">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-10 min-w-0 rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] px-3 text-sm text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted)]"
                placeholder="Search memory and indexed files"
              />
              <input
                type="number"
                min={3}
                max={24}
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value) || 10)}
                className="h-10 rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] px-3 text-sm text-[color:var(--text)] outline-none"
              />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-xs text-[color:var(--muted)]">
                {result ? `${result.sourceCount} source(s), ${result.chunkCount} chunk(s)` : "Local hybrid retrieval"}
              </div>
              <button
                type="submit"
                disabled={busy || !query.trim()}
                className="h-9 rounded-full bg-[color:var(--button)] px-4 text-xs font-medium text-[color:var(--button-text)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Searching" : "Search"}
              </button>
            </div>
          </form>

          {error && <div className="text-xs text-red-600">{error}</div>}

          {result ? (
            <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-[color:var(--text)]">Answer</div>
                <span className="rounded-full border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]">
                  {result.usedModel ? "model" : "fallback"}
                </span>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-6 text-[color:var(--text)]">
                {result.answer}
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-3 text-sm text-[color:var(--muted)]">
              Enter a query to search indexed chunks and memory.
            </section>
          )}

          {result && (
            <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
              <div className="mb-3 flex gap-2">
                {(["sources", "chunks", "memory"] as SearchTab[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTab(item)}
                    className={`h-8 rounded-full px-3 text-xs transition-colors ${
                      tab === item
                        ? "bg-[color:var(--button)] text-[color:var(--button-text)]"
                        : "border border-[color:var(--border)] text-[color:var(--muted)] hover:bg-[color:var(--selected)]"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                {tab === "sources" &&
                  (sourceGroups.length === 0 ? (
                    <EmptyLine text="No knowledge sources found." />
                  ) : (
                    sourceGroups.map((group) => (
                      <SourceGroup key={group.sourceId} group={group} onOpenTarget={onOpenTarget} />
                    ))
                  ))}
                {tab === "chunks" &&
                  (result.knowledgeResults.length === 0 ? (
                    <EmptyLine text="No chunks found." />
                  ) : (
                    result.knowledgeResults.map((item) => (
                      <KnowledgeChunkRow key={item.chunk.id} result={item} onOpenTarget={onOpenTarget} />
                    ))
                  ))}
                {tab === "memory" &&
                  (result.memoryResults.length === 0 && result.relatedMemory.length === 0 ? (
                    <EmptyLine text="No related memory found." />
                  ) : (
                    <>
                      {result.memoryResults.map((item) => (
                        <MemoryRow key={item.item.id} result={item} onOpenTarget={onOpenTarget} />
                      ))}
                      {result.relatedMemory.map((item) => (
                        <div key={`${item.id}-${item.label}`} className="rounded-xl border border-[color:var(--border)] p-3">
                          <div className="truncate text-sm font-medium text-[color:var(--text)]">{item.title}</div>
                          <div className="mt-1 text-xs text-[color:var(--muted)]">
                            {item.label}, weight {Math.round(item.weight * 100)}%
                          </div>
                          <button
                            type="button"
                            onClick={() => void onOpenTarget(item.target)}
                            className="mt-2 h-7 rounded-full border border-[color:var(--border)] px-3 text-[11px] text-[color:var(--text)] hover:bg-[color:var(--selected)]"
                          >
                            Open
                          </button>
                        </div>
                      ))}
                    </>
                  ))}
              </div>
            </section>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
            <div className="text-xs font-semibold text-[color:var(--text)]">Score legend</div>
            <div className="mt-2 space-y-1 text-xs leading-5 text-[color:var(--muted)]">
              <div>Score combines vector, keyword, recency and feedback.</div>
              <div>Targets include file path plus chunk/page/offset when available.</div>
              <div>Use Open to jump to a file, URL, directory or chat target.</div>
            </div>
          </div>
          {result && (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
              <div className="text-xs font-semibold text-[color:var(--text)]">Query</div>
              <div className="mt-2 break-words font-mono text-xs leading-5 text-[color:var(--muted)]">
                {result.query}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function SourceGroup({
  group,
  onOpenTarget,
}: {
  group: ReturnType<typeof groupBySource>[number];
  onOpenTarget: (target: string) => Promise<void>;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--border)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[color:var(--text)]">{group.title}</div>
          <div className="mt-1 truncate text-xs text-[color:var(--muted)]">{group.path}</div>
        </div>
        <span className="rounded-full border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]">
          {Math.round(group.score * 100)}%
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[color:var(--muted)]">
        <span>{group.count} chunk(s)</span>
        <button
          type="button"
          onClick={() => void onOpenTarget(group.target)}
          className="h-7 rounded-full border border-[color:var(--border)] px-3 text-[color:var(--text)] hover:bg-[color:var(--selected)]"
        >
          Open
        </button>
      </div>
    </div>
  );
}

function KnowledgeChunkRow({
  result,
  onOpenTarget,
}: {
  result: KnowledgeSearchResult;
  onOpenTarget: (target: string) => Promise<void>;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--border)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[color:var(--text)]">{result.source.title}</div>
          <div className="mt-1 truncate font-mono text-[11px] text-[color:var(--muted)]">{result.chunk.target}</div>
        </div>
        <span className="rounded-full border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]">
          {Math.round(result.score * 100)}%
        </span>
      </div>
      <div className="mt-2 line-clamp-5 text-xs leading-5 text-[color:var(--muted)]">{result.chunk.text}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Pill text={`vector ${Math.round(result.vectorScore * 100)}%`} />
        <Pill text={`keyword ${Math.round(result.keywordScore * 100)}%`} />
        <Pill text={`${result.chunk.startOffset}-${result.chunk.endOffset}`} />
        <button
          type="button"
          onClick={() => void onOpenTarget(result.chunk.target)}
          className="h-7 rounded-full border border-[color:var(--border)] px-3 text-[11px] text-[color:var(--text)] hover:bg-[color:var(--selected)]"
        >
          Open
        </button>
      </div>
    </div>
  );
}

function MemoryRow({
  result,
  onOpenTarget,
}: {
  result: MemorySearchResult;
  onOpenTarget: (target: string) => Promise<void>;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--border)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[color:var(--text)]">{result.item.title}</div>
          <div className="mt-1 truncate font-mono text-[11px] text-[color:var(--muted)]">{result.item.target}</div>
        </div>
        <span className="rounded-full border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]">
          {Math.round(result.score * 100)}%
        </span>
      </div>
      <div className="mt-2 text-xs leading-5 text-[color:var(--muted)]">{result.item.description}</div>
      <button
        type="button"
        onClick={() => void onOpenTarget(result.item.target)}
        className="mt-2 h-7 rounded-full border border-[color:var(--border)] px-3 text-[11px] text-[color:var(--text)] hover:bg-[color:var(--selected)]"
      >
        Open
      </button>
    </div>
  );
}

function Pill({ text }: { text: string }) {
  return (
    <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
      {text}
    </span>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="text-sm text-[color:var(--muted)]">{text}</div>;
}

function groupBySource(results: KnowledgeSearchResult[]) {
  const map = new Map<
    string,
    { sourceId: string; title: string; path: string; target: string; score: number; count: number }
  >();
  for (const result of results) {
    const current = map.get(result.source.id);
    if (current) {
      current.score = Math.max(current.score, result.score);
      current.count += 1;
    } else {
      map.set(result.source.id, {
        sourceId: result.source.id,
        title: result.source.title,
        path: result.source.path,
        target: result.chunk.target,
        score: result.score,
        count: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.score - a.score);
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
