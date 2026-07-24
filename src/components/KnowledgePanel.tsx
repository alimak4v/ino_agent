import { useEffect, useState } from "react";
import { api, type KnowledgeSearchResult, type WatchedPath } from "../lib/api";

interface KnowledgePanelProps {
  onClose: () => void;
  onOpenTarget: (target: string) => Promise<void>;
  windowed?: boolean;
}

export function KnowledgePanel({ onClose: _onClose, onOpenTarget, windowed = false }: KnowledgePanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [watchedPaths, setWatchedPaths] = useState<WatchedPath[]>([]);
  const [watchPath, setWatchPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [error, setError] = useState("");
  const [watchStatus, setWatchStatus] = useState("");

  const loadWatchedPaths = async () => {
    setWatchedPaths(await api.listWatchedPaths());
  };

  useEffect(() => {
    void loadWatchedPaths().catch((e) => setError(formatError(e)));
  }, []);

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

  const handleWatchPath = async () => {
    const path = watchPath.trim();
    if (!path) return;
    setWatchBusy(true);
    setError("");
    setWatchStatus("");
    try {
      setWatchedPaths(await api.watchPath(path));
      setWatchPath("");
      setWatchStatus(`Watching ${path}`);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setWatchBusy(false);
    }
  };

  const handleUnwatchPath = async (path: string) => {
    setWatchBusy(true);
    setError("");
    setWatchStatus("");
    try {
      setWatchedPaths(await api.unwatchPath(path));
      setWatchStatus(`Stopped watching ${path}`);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setWatchBusy(false);
    }
  };

  const handlePollWatchedPaths = async () => {
    setWatchBusy(true);
    setError("");
    setWatchStatus("");
    try {
      const result = await api.pollWatchedPaths();
      setWatchStatus(summarizePollResult(result));
      await loadWatchedPaths();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setWatchBusy(false);
    }
  };

  return (
    <aside
      className={
        windowed
          ? "no-drag flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden bg-[color:var(--panel)]"
          : "no-drag fixed left-3 right-3 top-12 z-50 max-h-[calc(100vh-64px)] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] shadow-[0_12px_40px_rgba(0,0,0,0.14)] lg:left-auto lg:right-3 lg:w-[720px]"
      }
    >
      <div className={`${windowed ? "min-h-0 flex-1" : "max-h-[calc(100vh-122px)]"} overflow-y-auto p-6`}>
        <div className="mx-auto w-full max-w-[760px]">
        <div className="mb-4 text-sm text-[color:var(--muted)]">
          Indexed source chunks with vector and lexical search
        </div>
        <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-[color:var(--text)]">Watched paths</div>
              <div className="text-[11px] text-[color:var(--muted)]">
                Incremental reindex runs in the background.
              </div>
            </div>
            <button
              type="button"
              disabled={watchBusy}
              onClick={() => void handlePollWatchedPaths()}
              className="h-7 rounded-full border border-[color:var(--border)] px-3 text-[11px] text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reindex now
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={watchPath}
              onChange={(event) => setWatchPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleWatchPath();
              }}
              className="h-9 min-w-0 flex-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--panel)] px-3 text-xs text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted)]"
              placeholder="Path inside workspace, for example docs or src"
            />
            <button
              type="button"
              disabled={watchBusy || !watchPath.trim()}
              onClick={() => void handleWatchPath()}
              className="h-9 shrink-0 rounded-lg bg-[color:var(--text)] px-3 text-xs font-medium text-[color:var(--panel)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              Watch
            </button>
          </div>
          <div className="mt-3 space-y-1.5">
            {watchedPaths.length === 0 ? (
              <div className="text-xs text-[color:var(--muted)]">No watched paths yet.</div>
            ) : (
              watchedPaths.map((item) => (
                <div
                  key={item.path}
                  className="flex items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--panel)] px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-[color:var(--text)]">
                    {item.path}
                  </div>
                  <button
                    type="button"
                    disabled={watchBusy}
                    onClick={() => void handleUnwatchPath(item.path)}
                    className="h-6 rounded-full px-2 text-[11px] text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Unwatch
                  </button>
                </div>
              ))
            )}
          </div>
          {watchStatus && (
            <div className="mt-2 text-[11px] text-[color:var(--muted)]">{watchStatus}</div>
          )}
        </section>

        <div className="mt-4">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-10 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 text-sm text-[color:var(--text)] outline-none transition-shadow placeholder:text-[color:var(--muted)] focus:shadow-[0_0_0_3px_rgba(14,116,144,0.16)]"
          placeholder="Search indexed files and documents"
        />
        </div>
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

function summarizePollResult(result: unknown) {
  if (!result || typeof result !== "object") return "Reindex finished.";
  const record = result as Record<string, unknown>;
  const indexed = Array.isArray(record.indexed) ? record.indexed : [];
  const errors = Array.isArray(record.errors) ? record.errors : [];
  let files = 0;
  let chunks = 0;
  let unchanged = 0;
  for (const item of indexed) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    files += typeof value.indexedFiles === "number" ? value.indexedFiles : 0;
    chunks += typeof value.indexedChunks === "number" ? value.indexedChunks : 0;
    unchanged += typeof value.unchangedFiles === "number" ? value.unchangedFiles : 0;
  }
  return `Reindex finished: ${files} file(s), ${chunks} chunk(s), ${unchanged} unchanged, ${errors.length} error(s).`;
}
