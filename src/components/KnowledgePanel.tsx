import { useEffect, useState } from "react";
import { api, type KnowledgeSearchResult } from "../lib/api";

interface KnowledgePanelProps {
  onClose: () => void;
  onOpenTarget: (target: string) => Promise<void>;
}

export function KnowledgePanel({ onClose, onOpenTarget }: KnowledgePanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setError("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setBusy(true);
      setError("");
      void api
        .searchKnowledge(trimmed, 16)
        .then((next) => {
          if (!cancelled) setResults(next);
        })
        .catch((e) => {
          if (!cancelled) setError(formatError(e));
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <aside className="no-drag fixed left-3 right-3 top-12 z-50 max-h-[calc(100vh-64px)] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)]/95 shadow-[0_12px_40px_rgba(0,0,0,0.14)] backdrop-blur-xl lg:left-auto lg:right-3 lg:w-[720px]">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[color:var(--text)]">Knowledge</div>
          <div className="truncate text-xs text-[color:var(--muted)]">
            Indexed source chunks with vector and lexical search
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

      <div className="max-h-[calc(100vh-122px)] overflow-y-auto p-4">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-10 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 text-sm text-[color:var(--text)] outline-none transition-shadow placeholder:text-[color:var(--muted)] focus:shadow-[0_0_0_3px_rgba(14,116,144,0.16)]"
          placeholder="Search indexed files and documents"
        />
        {error && <div className="mt-3 text-xs text-red-600">{error}</div>}
        <div className="mt-3 space-y-2">
          {!query.trim() ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-3 text-sm text-[color:var(--muted)]">
              Type a query to search indexed chunks.
            </div>
          ) : busy && results.length === 0 ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-3 text-sm text-[color:var(--muted)]">
              Searching
            </div>
          ) : results.length === 0 ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-3 text-sm text-[color:var(--muted)]">
              No indexed chunks found.
            </div>
          ) : (
            results.map((result) => (
              <KnowledgeRow
                key={result.chunk.id}
                result={result}
                onOpenTarget={onOpenTarget}
              />
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

function KnowledgeRow({
  result,
  onOpenTarget,
}: {
  result: KnowledgeSearchResult;
  onOpenTarget: (target: string) => Promise<void>;
}) {
  const [feedback, setFeedback] = useState("");
  const sendFeedback = async (rating: "useful" | "not_useful") => {
    setFeedback(rating);
    await api.recordFeedback({
      targetType: "knowledge_chunk",
      targetId: result.chunk.id,
      target: result.chunk.target,
      rating,
    });
  };

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[color:var(--text)]">
            {result.source.title}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-[color:var(--muted)]">
            {result.source.path}
          </div>
        </div>
        <div className="rounded-full border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]">
          {Math.round(result.score * 100)}%
        </div>
      </div>
      <div className="mt-2 line-clamp-4 text-xs leading-5 text-[color:var(--muted)]">
        {result.chunk.text}
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]">
        <span className="min-w-0 flex-1 truncate">{result.chunk.target}</span>
        <button
          type="button"
          onClick={() => void onOpenTarget(result.chunk.target)}
          className="h-6 shrink-0 rounded-full px-2 text-[11px] text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)]"
        >
          Open
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
          {result.source.sourceType}
        </span>
        <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
          vector {Math.round(result.vectorScore * 100)}%
        </span>
        <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
          lexical {Math.round(result.keywordScore * 100)}%
        </span>
        <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
          {result.chunk.startOffset}-{result.chunk.endOffset}
        </span>
        <button
          type="button"
          onClick={() => void sendFeedback("useful")}
          className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
            feedback === "useful"
              ? "border-[color:var(--accent)] text-[color:var(--accent)]"
              : "border-[color:var(--border)] text-[color:var(--muted)] hover:bg-[color:var(--selected)]"
          }`}
        >
          Useful
        </button>
        <button
          type="button"
          onClick={() => void sendFeedback("not_useful")}
          className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
            feedback === "not_useful"
              ? "border-red-500/50 text-red-600"
              : "border-[color:var(--border)] text-[color:var(--muted)] hover:bg-[color:var(--selected)]"
          }`}
        >
          Not useful
        </button>
      </div>
    </div>
  );
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
