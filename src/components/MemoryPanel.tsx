import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  api,
  type FeedbackSummary,
  type MemoryDecision,
  type MemoryGraph,
  type MemoryInput,
  type MemoryItem,
  type MemoryReviewItem,
  type MemorySearchResult,
} from "../lib/api";

interface MemoryPanelProps {
  onClose: () => void;
  onOpenTarget: (target: string) => Promise<void>;
}

const EMPTY_GRAPH: MemoryGraph = { nodes: [], links: [] };

export function MemoryPanel({ onClose, onOpenTarget }: MemoryPanelProps) {
  const [activeView, setActiveView] = useState<"browse" | "review" | "io">("browse");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [recent, setRecent] = useState<MemoryItem[]>([]);
  const [review, setReview] = useState<MemoryReviewItem[]>([]);
  const [graph, setGraph] = useState<MemoryGraph>(EMPTY_GRAPH);
  const [decisions, setDecisions] = useState<MemoryDecision[]>([]);
  const [feedbackSummary, setFeedbackSummary] = useState<FeedbackSummary[]>([]);
  const [exportText, setExportText] = useState("");
  const [importText, setImportText] = useState("");
  const [importSummary, setImportSummary] = useState("");
  const [selectedMemoryId, setSelectedMemoryId] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<MemoryInput>({
    title: "",
    description: "",
    target: "",
    sourceType: "text",
    tags: [],
    importance: 7,
    memoryKind: "note",
    confidence: 0.7,
    stability: "durable",
  });

  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      const [nextRecent, nextReview, nextGraph, nextDecisions, nextFeedbackSummary] = await Promise.all([
        api.listMemoryRecent(24),
        api.listMemoryReview(24),
        api.getMemoryGraph(36),
        api.listMemoryDecisions(24),
        api.listFeedbackSummary(12),
      ]);
      setRecent(nextRecent);
      setReview(nextReview);
      setGraph(nextGraph);
      setDecisions(nextDecisions);
      setFeedbackSummary(nextFeedbackSummary);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api
        .searchMemory(trimmed, 12)
        .then((next) => {
          if (!cancelled) setResults(next);
        })
        .catch((e) => {
          if (!cancelled) setError(formatError(e));
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const visibleItems = query.trim() ? results.map((result) => result.item) : recent;
  const graphLayout = useMemo(() => layoutGraph(graph), [graph]);
  const selectedMemory = graph.nodes.find((node) => node.id === selectedMemoryId) ?? null;

  useEffect(() => {
    if (!selectedMemoryId) return;
    if (!graph.nodes.some((node) => node.id === selectedMemoryId)) {
      setSelectedMemoryId("");
    }
  }, [graph.nodes, selectedMemoryId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const description = draft.description.trim();
    const target = draft.target.trim();
    if (!description || !target || busy) return;
    setBusy(true);
    setError("");
    try {
      const input = {
        ...draft,
        title: draft.title?.trim() || null,
        description,
        target,
        sourceType: draft.sourceType?.trim() || null,
        tags: parseTags(draft.tags?.join(",") ?? ""),
      };
      if (editingMemoryId) {
        await api.updateMemory(editingMemoryId, input);
      } else {
        await api.addMemory(input);
      }
      setDraft({
        title: "",
        description: "",
        target: "",
        sourceType: "text",
        tags: [],
        importance: 7,
        memoryKind: "note",
        confidence: 0.7,
        stability: "durable",
      });
      setEditingMemoryId("");
      setQuery("");
      await refresh();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const editMemory = (item: MemoryItem) => {
    setEditingMemoryId(item.id);
    setDraft(memoryItemToInput(item));
  };

  const cancelEdit = () => {
    setEditingMemoryId("");
    setDraft({
      title: "",
      description: "",
      target: "",
      sourceType: "text",
      tags: [],
      importance: 7,
      memoryKind: "note",
      confidence: 0.7,
      stability: "durable",
    });
  };

  const mergeIntoSelected = async (removeId: string) => {
    if (!selectedMemoryId || selectedMemoryId === removeId || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.mergeMemory(selectedMemoryId, removeId);
      await refresh();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const mergeReviewDuplicate = async (item: MemoryItem, duplicateOf: MemoryItem) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.mergeMemory(duplicateOf.id, item.id);
      setSelectedMemoryId(duplicateOf.id);
      await refresh();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const exportMemoryJson = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setImportSummary("");
    try {
      setExportText(await api.exportMemory());
      setActiveView("io");
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const importMemoryJson = async () => {
    if (busy || !importText.trim()) return;
    setBusy(true);
    setError("");
    setImportSummary("");
    try {
      const result = await api.importMemory(importText);
      setImportSummary(
        `Imported ${result.imported}, skipped ${result.skipped}, updated ${result.updated}, errors ${result.errors.length}.`,
      );
      await refresh();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="no-drag fixed left-3 right-3 top-12 z-50 max-h-[calc(100vh-64px)] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] shadow-[0_12px_40px_rgba(0,0,0,0.14)] lg:left-auto lg:right-3 lg:w-[760px]">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[color:var(--text)]">Memory</div>
          <div className="truncate text-xs text-[color:var(--muted)]">
            Vector recall with source locations
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
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-1">
            <ViewButton active={activeView === "browse"} onClick={() => setActiveView("browse")}>
              Browse
            </ViewButton>
            <ViewButton active={activeView === "review"} onClick={() => setActiveView("review")}>
              Review
            </ViewButton>
            <ViewButton active={activeView === "io"} onClick={() => setActiveView("io")}>
              Import
            </ViewButton>
          </div>

          {activeView === "browse" && (
            <>
              <form onSubmit={submit} className="grid gap-2">
            {editingMemoryId && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-2 text-xs text-[color:var(--muted)]">
                <span className="min-w-0 truncate">Editing memory</span>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="h-6 rounded-full px-2 text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)]"
                >
                  Cancel
                </button>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
              <input
                value={draft.title ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                className={inputClass}
                placeholder="Title"
              />
              <select
                value={draft.sourceType ?? "text"}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, sourceType: event.target.value }))
                }
                className={inputClass}
              >
                <option value="text">text</option>
                <option value="file">file</option>
                <option value="pdf">pdf</option>
                <option value="image">image</option>
                <option value="code">code</option>
                <option value="link">link</option>
                <option value="chat">chat</option>
              </select>
            </div>
            <textarea
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              className={`${inputClass} h-24 resize-none py-2`}
              placeholder="Text description of the memory"
            />
            <input
              value={draft.target}
              onChange={(event) => setDraft((current) => ({ ...current, target: event.target.value }))}
              className={inputClass}
              placeholder="/path/to/file.pdf, https://..., chat://..., or text location"
            />
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
              <input
                value={draft.tags?.join(", ") ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, tags: parseTags(event.target.value) }))
                }
                className={inputClass}
                placeholder="tags"
              />
              <input
                type="number"
                min={0}
                max={10}
                step={1}
                value={draft.importance ?? 7}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, importance: Number(event.target.value) }))
                }
                className={inputClass}
                placeholder="importance"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <select
                value={draft.memoryKind ?? "note"}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, memoryKind: event.target.value }))
                }
                className={inputClass}
              >
                <option value="fact">fact</option>
                <option value="preference">preference</option>
                <option value="project_decision">project_decision</option>
                <option value="source">source</option>
                <option value="todo">todo</option>
                <option value="note">note</option>
              </select>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={draft.confidence ?? 0.7}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, confidence: Number(event.target.value) }))
                }
                className={inputClass}
                placeholder="confidence"
              />
              <select
                value={draft.stability ?? "durable"}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, stability: event.target.value }))
                }
                className={inputClass}
              >
                <option value="temporary">temporary</option>
                <option value="durable">durable</option>
                <option value="permanent">permanent</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={busy || !draft.description.trim() || !draft.target.trim()}
              className="h-9 rounded-full bg-[color:var(--button)] px-4 text-sm font-medium text-[color:var(--button-text)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {editingMemoryId ? "Save memory" : "Remember"}
            </button>
              </form>

              <div className="space-y-2">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className={inputClass}
                  placeholder="Recall by meaning"
                />
                {error && <div className="text-xs text-red-600">{error}</div>}
                <div className="space-y-2">
                  {visibleItems.length === 0 ? (
                    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-3 text-sm text-[color:var(--muted)]">
                      {busy ? "Loading" : "No memories yet"}
                    </div>
                  ) : (
                    visibleItems.map((item) => {
                      const result = results.find((candidate) => candidate.item.id === item.id);
                      return (
                        <MemoryRow
                          key={item.id}
                          item={item}
                          result={result}
                          onOpenTarget={onOpenTarget}
                          onDeleted={refresh}
                          onEdit={editMemory}
                          primaryId={selectedMemoryId}
                          onSetPrimary={setSelectedMemoryId}
                          onMergeIntoPrimary={mergeIntoSelected}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}

          {activeView === "review" && (
            <MemoryReviewQueue
              items={review}
              busy={busy}
              decisions={decisions}
              onOpenTarget={onOpenTarget}
              onDeleted={refresh}
              onEdit={(item) => {
                editMemory(item);
                setActiveView("browse");
              }}
              onMergeDuplicate={mergeReviewDuplicate}
              onSelect={setSelectedMemoryId}
            />
          )}

          {activeView === "io" && (
            <MemoryImportExport
              busy={busy}
              exportText={exportText}
              importText={importText}
              importSummary={importSummary}
              error={error}
              onExport={exportMemoryJson}
              onImport={importMemoryJson}
              onImportTextChange={setImportText}
            />
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium text-[color:var(--text)]">Graph</div>
            <div className="text-xs text-[color:var(--muted)]">
              {graph.nodes.length} nodes / {graph.links.length} links
            </div>
          </div>
          <svg
            className="h-[320px] w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)]"
            viewBox="0 0 320 320"
            role="img"
            aria-label="Memory graph"
          >
            {graphLayout.links.map((link) => {
              const active =
                selectedMemoryId &&
                (link.sourceId === selectedMemoryId || link.targetId === selectedMemoryId);
              return (
                <line
                  key={`${link.sourceId}-${link.targetId}`}
                  x1={link.source.x}
                  y1={link.source.y}
                  x2={link.target.x}
                  y2={link.target.y}
                  stroke={active ? "var(--accent)" : "var(--border)"}
                  strokeWidth={active ? 2.5 + link.weight * 2 : 1 + link.weight * 2}
                  opacity={!selectedMemoryId || active ? 1 : 0.35}
                />
              );
            })}
            {graphLayout.nodes.map((node) => {
              const selected = node.item.id === selectedMemoryId;
              const adjacent =
                selectedMemoryId &&
                graph.links.some(
                  (link) =>
                    (link.sourceId === selectedMemoryId && link.targetId === node.item.id) ||
                    (link.targetId === selectedMemoryId && link.sourceId === node.item.id),
                );
              const showLabel = selected || adjacent || graphLayout.nodes.length <= 14;
              return (
                <g
                  key={node.item.id}
                  className="cursor-pointer outline-none"
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setSelectedMemoryId((current) =>
                      current === node.item.id ? "" : node.item.id,
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedMemoryId((current) =>
                        current === node.item.id ? "" : node.item.id,
                      );
                    }
                  }}
                >
                  <title>{node.item.title}</title>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.radius}
                    fill="var(--accent)"
                    opacity={!selectedMemoryId || selected || adjacent ? 0.9 : 0.34}
                    stroke={selected ? "var(--text)" : "transparent"}
                    strokeWidth={selected ? 2.5 : 0}
                  />
                  {showLabel && (
                    <text
                      x={node.x}
                      y={node.y + node.radius + 10}
                      textAnchor="middle"
                      className="pointer-events-none fill-[color:var(--muted)] text-[9px]"
                    >
                      {shortLabel(node.item.title)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <MemoryGraphDebug
            graph={graph}
            selected={selectedMemory}
            selectedId={selectedMemoryId}
            decisions={decisions}
            feedbackSummary={feedbackSummary}
            onSelect={setSelectedMemoryId}
          />
        </div>
      </div>
    </aside>
  );
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 rounded-lg text-xs font-medium transition-colors ${
        active
          ? "bg-[color:var(--panel)] text-[color:var(--text)] shadow-sm"
          : "text-[color:var(--muted)] hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
      }`}
    >
      {children}
    </button>
  );
}

function MemoryReviewQueue({
  items,
  busy,
  decisions,
  onOpenTarget,
  onDeleted,
  onEdit,
  onMergeDuplicate,
  onSelect,
}: {
  items: MemoryReviewItem[];
  busy: boolean;
  decisions: MemoryDecision[];
  onOpenTarget: (target: string) => Promise<void>;
  onDeleted: () => Promise<void>;
  onEdit: (item: MemoryItem) => void;
  onMergeDuplicate: (item: MemoryItem, duplicateOf: MemoryItem) => Promise<void>;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-3 text-sm text-[color:var(--muted)]">
        {busy ? "Loading review queue" : "No cleanup suggestions right now"}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <MemoryReviewCard
          key={item.id}
          review={item}
          decisions={decisions}
          onOpenTarget={onOpenTarget}
          onDeleted={onDeleted}
          onEdit={onEdit}
          onMergeDuplicate={onMergeDuplicate}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function MemoryReviewCard({
  review,
  decisions,
  onOpenTarget,
  onDeleted,
  onEdit,
  onMergeDuplicate,
  onSelect,
}: {
  review: MemoryReviewItem;
  decisions: MemoryDecision[];
  onOpenTarget: (target: string) => Promise<void>;
  onDeleted: () => Promise<void>;
  onEdit: (item: MemoryItem) => void;
  onMergeDuplicate: (item: MemoryItem, duplicateOf: MemoryItem) => Promise<void>;
  onSelect: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [merging, setMerging] = useState(false);
  const why = decisions.find((decision) => {
    const rememberedTitle = decision.itemTitle ?? "";
    const rememberedDescription = decision.itemDescription ?? "";
    return (
      decision.target === review.item.target ||
      rememberedTitle === review.item.title ||
      (rememberedDescription.length > 20 &&
        review.item.description.includes(rememberedDescription.slice(0, 80)))
    );
  });
  const deleteItem = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await api.deleteMemory(review.item.id);
      await onDeleted();
    } finally {
      setDeleting(false);
    }
  };
  const mergeDuplicate = async () => {
    if (!review.duplicateOf || merging) return;
    setMerging(true);
    try {
      await onMergeDuplicate(review.item, review.duplicateOf);
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
              {review.kind.replace("_", " ")}
            </span>
            <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
              {review.suggestedAction.replace("_", " ")}
            </span>
            <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
              {Math.round(review.score * 100)}%
            </span>
          </div>
          <div className="mt-2 truncate text-sm font-medium text-[color:var(--text)]">
            {review.item.title}
          </div>
          <div className="mt-1 line-clamp-3 text-xs leading-5 text-[color:var(--muted)]">
            {review.reason}
          </div>
        </div>
      </div>

      {review.duplicateOf && (
        <div className="mt-2 rounded-lg border border-[color:var(--border)] px-2 py-1.5 text-[11px] text-[color:var(--muted)]">
          Merge into <span className="text-[color:var(--text)]">{review.duplicateOf.title}</span>
          <code className="mt-1 block truncate">{review.duplicateOf.target}</code>
        </div>
      )}

      <div className="mt-2 rounded-lg border border-[color:var(--border)] px-2 py-1.5 text-[11px] text-[color:var(--muted)]">
        <div className="line-clamp-2">{review.item.description}</div>
        <code className="mt-1 block truncate">{review.item.target}</code>
      </div>

      {why && (
        <div className="mt-2 rounded-lg border border-[color:var(--border)] px-2 py-1.5 text-[11px] text-[color:var(--muted)]">
          <span className="font-medium text-[color:var(--text)]">Why remembered: </span>
          {why.action} / {why.reason}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => void onOpenTarget(review.item.target)}
          className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)]"
        >
          Open
        </button>
        <button
          type="button"
          onClick={() => onEdit(review.item)}
          className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)]"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onSelect(review.item.id)}
          className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)]"
        >
          Graph
        </button>
        {review.duplicateOf && (
          <button
            type="button"
            onClick={() => void mergeDuplicate()}
            disabled={merging}
            className="rounded-full border border-[color:var(--accent)] px-2 py-0.5 text-[11px] text-[color:var(--accent)] transition-colors hover:bg-[color:var(--selected)] disabled:opacity-40"
          >
            Merge
          </button>
        )}
        <button
          type="button"
          onClick={() => void deleteItem()}
          disabled={deleting}
          className="rounded-full border border-red-500/30 px-2 py-0.5 text-[11px] text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-40"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function MemoryImportExport({
  busy,
  exportText,
  importText,
  importSummary,
  error,
  onExport,
  onImport,
  onImportTextChange,
}: {
  busy: boolean;
  exportText: string;
  importText: string;
  importSummary: string;
  error: string;
  onExport: () => Promise<void>;
  onImport: () => Promise<void>;
  onImportTextChange: (value: string) => void;
}) {
  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-red-600">{error}</div>}
      {importSummary && (
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-2 text-xs text-[color:var(--muted)]">
          {importSummary}
        </div>
      )}
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-[color:var(--text)]">Export memory</div>
          <button
            type="button"
            onClick={() => void onExport()}
            disabled={busy}
            className="h-7 rounded-full border border-[color:var(--border)] px-3 text-xs text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)] disabled:opacity-40"
          >
            Export JSON
          </button>
        </div>
        <textarea
          readOnly
          value={exportText}
          className={`${inputClass} mt-2 h-44 resize-none py-2 font-mono text-xs`}
          placeholder="Exported JSON appears here"
        />
      </div>

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-[color:var(--text)]">Import memory</div>
          <button
            type="button"
            onClick={() => void onImport()}
            disabled={busy || !importText.trim()}
            className="h-7 rounded-full border border-[color:var(--border)] px-3 text-xs text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)] disabled:opacity-40"
          >
            Import JSON
          </button>
        </div>
        <textarea
          value={importText}
          onChange={(event) => onImportTextChange(event.target.value)}
          className={`${inputClass} mt-2 h-44 resize-none py-2 font-mono text-xs`}
          placeholder='{"version":1,"items":[...]}'
        />
      </div>
    </div>
  );
}

function MemoryRow({
  item,
  result,
  onOpenTarget,
  onDeleted,
  onEdit,
  primaryId,
  onSetPrimary,
  onMergeIntoPrimary,
}: {
  item: MemoryItem;
  result?: MemorySearchResult;
  onOpenTarget: (target: string) => Promise<void>;
  onDeleted: () => Promise<void>;
  onEdit: (item: MemoryItem) => void;
  primaryId: string;
  onSetPrimary: (id: string) => void;
  onMergeIntoPrimary: (removeId: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [feedback, setFeedback] = useState("");
  const deleteItem = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await api.deleteMemory(item.id);
      await onDeleted();
    } finally {
      setDeleting(false);
    }
  };
  const mergeItem = async () => {
    if (!primaryId || primaryId === item.id || merging) return;
    setMerging(true);
    try {
      await onMergeIntoPrimary(item.id);
    } finally {
      setMerging(false);
    }
  };
  const sendFeedback = async (rating: "useful" | "not_useful") => {
    setFeedback(rating);
    await api.recordFeedback({
      targetType: "memory",
      targetId: item.id,
      target: item.target,
      rating,
    });
  };

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[color:var(--text)]">{item.title}</div>
          <div className="mt-1 line-clamp-3 text-xs leading-5 text-[color:var(--muted)]">
            {item.description}
          </div>
        </div>
        {result && (
          <div className="rounded-full border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]">
            {Math.round(result.score * 100)}%
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]">
        <span className="min-w-0 flex-1 truncate">{item.target}</span>
        <button
          type="button"
          onClick={() => void onOpenTarget(item.target)}
          className="h-6 shrink-0 rounded-full px-2 text-[11px] text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)]"
        >
          Open
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
          {item.sourceType}
        </span>
        <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
          {item.memoryKind}
        </span>
        <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
          importance {item.importance}
        </span>
        <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
          confidence {Math.round(item.confidence * 100)}%
        </span>
        <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
          {item.stability}
        </span>
        {item.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]"
          >
            #{tag}
          </span>
        ))}
        <button
          type="button"
          onClick={() => void deleteItem()}
          disabled={deleting}
          className="rounded-full border border-red-500/30 px-2 py-0.5 text-[11px] text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-40"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => onEdit(item)}
          className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)]"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onSetPrimary(item.id)}
          className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
            primaryId === item.id
              ? "border-[color:var(--accent)] text-[color:var(--accent)]"
              : "border-[color:var(--border)] text-[color:var(--muted)] hover:bg-[color:var(--selected)]"
          }`}
        >
          {primaryId === item.id ? "Primary" : "Set primary"}
        </button>
        {primaryId && primaryId !== item.id && (
          <button
            type="button"
            onClick={() => void mergeItem()}
            disabled={merging}
            className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)] disabled:opacity-40"
          >
            Merge into primary
          </button>
        )}
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

function memoryItemToInput(item: MemoryItem): MemoryInput {
  return {
    title: item.title,
    description: item.description,
    target: item.target,
    sourceType: item.sourceType,
    tags: item.tags,
    importance: item.importance,
    memoryKind: item.memoryKind,
    confidence: item.confidence,
    stability: item.stability,
  };
}

function MemoryGraphDebug({
  graph,
  selected,
  selectedId,
  decisions,
  feedbackSummary,
  onSelect,
}: {
  graph: MemoryGraph;
  selected: MemoryItem | null;
  selectedId: string;
  decisions: MemoryDecision[];
  feedbackSummary: FeedbackSummary[];
  onSelect: (id: string) => void;
}) {
  const degrees = useMemo(() => {
    const result = new Map<string, number>();
    for (const node of graph.nodes) {
      result.set(node.id, 0);
    }
    for (const link of graph.links) {
      result.set(link.sourceId, (result.get(link.sourceId) ?? 0) + 1);
      result.set(link.targetId, (result.get(link.targetId) ?? 0) + 1);
    }
    return result;
  }, [graph]);
  const selectedLinks = selectedId
    ? graph.links.filter((link) => link.sourceId === selectedId || link.targetId === selectedId)
    : [];
  const selectedNeighborIds = new Set(
    selectedLinks.map((link) => (link.sourceId === selectedId ? link.targetId : link.sourceId)),
  );

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-[color:var(--text)]">Debug</div>
        <button
          type="button"
          onClick={() => onSelect("")}
          disabled={!selectedId}
          className="h-7 rounded-full px-2.5 text-xs text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)] disabled:opacity-40"
        >
          Clear
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px] text-[color:var(--muted)]">
        <DebugMetric label="nodes" value={graph.nodes.length} />
        <DebugMetric label="links" value={graph.links.length} />
        <DebugMetric label="decisions" value={decisions.length} />
        <DebugMetric label="feedback" value={feedbackSummary.length} />
        <DebugMetric
          label="selected"
          value={selected ? String(degrees.get(selected.id) ?? 0) : "-"}
        />
      </div>

      <div className="rounded-lg border border-[color:var(--border)] p-2">
        <div className="mb-1 text-[11px] font-medium text-[color:var(--text)]">
          Selected node
        </div>
        {selected ? (
          <div className="space-y-1 text-[11px] text-[color:var(--muted)]">
            <DebugLine label="id" value={selected.id} />
            <DebugLine label="type" value={selected.sourceType} />
            <DebugLine label="kind" value={selected.memoryKind} />
            <DebugLine label="importance" value={String(selected.importance)} />
            <DebugLine label="confidence" value={`${Math.round(selected.confidence * 100)}%`} />
            <DebugLine label="stability" value={selected.stability} />
            <DebugLine label="access" value={String(selected.accessCount)} />
            <DebugLine label="target" value={selected.target} />
          </div>
        ) : (
          <div className="text-[11px] text-[color:var(--muted)]">Click a graph node.</div>
        )}
      </div>

      <details open className="rounded-lg border border-[color:var(--border)] p-2">
        <summary className="cursor-pointer text-[11px] font-medium text-[color:var(--text)]">
          Feedback
        </summary>
        <div className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-1">
          {feedbackSummary.length === 0 ? (
            <div className="text-[11px] text-[color:var(--muted)]">No feedback yet.</div>
          ) : (
            feedbackSummary.map((item) => (
              <div
                key={item.targetType}
                className="grid grid-cols-[minmax(0,1fr)_72px] gap-2 rounded-lg border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]"
              >
                <span className="truncate text-[color:var(--text)]">{item.targetType}</span>
                <span className="text-right">
                  {item.positive}/{item.negative} · {formatFeedbackScore(item.score)}
                </span>
              </div>
            ))
          )}
        </div>
      </details>

      <details open className="rounded-lg border border-[color:var(--border)] p-2">
        <summary className="cursor-pointer text-[11px] font-medium text-[color:var(--text)]">
          Auto memory policy
        </summary>
        <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
          {decisions.length === 0 ? (
            <div className="text-[11px] text-[color:var(--muted)]">No decisions yet.</div>
          ) : (
            decisions.map((decision) => (
              <div
                key={decision.id}
                className="rounded-lg border border-[color:var(--border)] px-2 py-1.5 text-[11px] text-[color:var(--muted)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[color:var(--text)]">
                    {decision.action} / {decision.reason}
                  </span>
                  <span>{formatDecisionScore(decision.score)}</span>
                </div>
                <div className="mt-1 truncate">
                  {decision.itemTitle || decision.itemDescription || decision.target}
                </div>
                <code className="mt-1 block truncate">{decision.target}</code>
              </div>
            ))
          )}
        </div>
      </details>

      <details open className="rounded-lg border border-[color:var(--border)] p-2">
        <summary className="cursor-pointer text-[11px] font-medium text-[color:var(--text)]">
          Nodes
        </summary>
        <div className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-1">
          {graph.nodes.map((node) => {
            const selectedNode = node.id === selectedId;
            const adjacent = selectedNeighborIds.has(node.id);
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => onSelect(node.id)}
                className={`grid w-full grid-cols-[56px_minmax(0,1fr)_28px] gap-2 rounded-lg px-2 py-1 text-left text-[11px] transition-colors ${
                  selectedNode
                    ? "bg-[color:var(--selected)] text-[color:var(--text)]"
                    : adjacent
                      ? "bg-[color:var(--panel-soft)] text-[color:var(--text)]"
                      : "text-[color:var(--muted)] hover:bg-[color:var(--panel-soft)]"
                }`}
              >
                <code className="truncate">{shortId(node.id)}</code>
                <span className="truncate">{node.title}</span>
                <span className="text-right">{degrees.get(node.id) ?? 0}</span>
              </button>
            );
          })}
        </div>
      </details>

      <details open className="rounded-lg border border-[color:var(--border)] p-2">
        <summary className="cursor-pointer text-[11px] font-medium text-[color:var(--text)]">
          Links
        </summary>
        <div className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-1">
          {(selectedId ? selectedLinks : graph.links).length === 0 ? (
            <div className="text-[11px] text-[color:var(--muted)]">No links.</div>
          ) : (
            (selectedId ? selectedLinks : graph.links).map((link) => (
              <div
                key={`${link.sourceId}-${link.targetId}`}
                className="grid grid-cols-[minmax(0,1fr)_48px] gap-2 rounded-lg border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]"
              >
                <span className="truncate">
                  <code>{shortId(link.sourceId)}</code> {"->"} <code>{shortId(link.targetId)}</code>{" "}
                  {link.label}
                </span>
                <span className="text-right">{formatWeight(link.weight)}</span>
              </div>
            ))
          )}
        </div>
      </details>
    </div>
  );
}

function DebugMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-[color:var(--border)] px-2 py-1">
      <div>{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-[color:var(--text)]">{value}</div>
    </div>
  );
}

function DebugLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
      <span>{label}</span>
      <code className="truncate text-[color:var(--text)]">{value}</code>
    </div>
  );
}

const inputClass =
  "min-h-9 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 text-sm text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted)] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.035)]";

function parseTags(value: string) {
  return value
    .split(/[,\s]+/)
    .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
}

function layoutGraph(graph: MemoryGraph) {
  const width = 320;
  const height = 320;
  const padding = 26;
  const centerX = width / 2;
  const centerY = height / 2;
  const degrees = new Map<string, number>();
  for (const item of graph.nodes) degrees.set(item.id, 0);
  for (const link of graph.links) {
    degrees.set(link.sourceId, (degrees.get(link.sourceId) ?? 0) + 1);
    degrees.set(link.targetId, (degrees.get(link.targetId) ?? 0) + 1);
  }
  const nodes = graph.nodes.map((item, index) => {
    const count = Math.max(graph.nodes.length, 1);
    const angle = (Math.PI * 2 * index) / count + seededAngle(item.id);
    const ring = Math.min(width, height) * (0.22 + 0.28 * ((index % 5) / 4));
    return {
      item,
      radius: 8 + item.importance * 0.55 + Math.min(degrees.get(item.id) ?? 0, 5) * 0.6,
      x: centerX + Math.cos(angle) * ring,
      y: centerY + Math.sin(angle) * ring,
    };
  });
  const byId = new Map(nodes.map((node) => [node.item.id, node]));
  if (nodes.length > 1) {
    for (let iteration = 0; iteration < 90; iteration += 1) {
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x || 0.01;
          const dy = a.y - b.y || 0.01;
          const distanceSq = Math.max(dx * dx + dy * dy, 36);
          const force = 620 / distanceSq;
          const fx = dx * force;
          const fy = dy * force;
          a.x += fx;
          a.y += fy;
          b.x -= fx;
          b.y -= fy;
        }
      }
      for (const link of graph.links) {
        const source = byId.get(link.sourceId);
        const target = byId.get(link.targetId);
        if (!source || !target) continue;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const preferred = 72 + (1 - Math.min(link.weight, 1)) * 46;
        const force = (distance - preferred) * 0.016 * Math.max(link.weight, 0.2);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        source.x += fx;
        source.y += fy;
        target.x -= fx;
        target.y -= fy;
      }
      for (const node of nodes) {
        node.x += (centerX - node.x) * 0.012;
        node.y += (centerY - node.y) * 0.012;
        node.x = clamp(node.x, padding + node.radius, width - padding - node.radius);
        node.y = clamp(node.y, padding + node.radius, height - padding - node.radius - 12);
      }
    }
  }
  const links = graph.links
    .map((link) => {
      const source = byId.get(link.sourceId);
      const target = byId.get(link.targetId);
      if (!source || !target) return null;
      return { ...link, source, target };
    })
    .filter(Boolean) as Array<
    MemoryGraph["links"][number] & {
      source: (typeof nodes)[number];
      target: (typeof nodes)[number];
    }
  >;
  return { nodes, links };
}

function seededAngle(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return (hash / 0xffffffff) * 0.42;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function shortLabel(value: string) {
  return value.length > 16 ? `${value.slice(0, 15)}...` : value;
}

function shortId(value: string) {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function formatWeight(value: number) {
  return value.toFixed(3);
}

function formatDecisionScore(value: number | null | undefined) {
  return typeof value === "number" ? value.toFixed(2) : "-";
}

function formatFeedbackScore(value: number) {
  return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

function formatError(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
