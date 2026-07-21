import { type FormEvent, useEffect, useMemo, useState } from "react";
import { api, type AgentRunDetail } from "../lib/api";

interface AgentTasksPanelProps {
  treeId: string | null;
  nodeId: string | null;
  onClose: () => void;
}

export function AgentTasksPanel({ treeId, nodeId, onClose }: AgentTasksPanelProps) {
  const [runs, setRuns] = useState<AgentRunDetail[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [goal, setGoal] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [steppingRunId, setSteppingRunId] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(
    () => runs.find((item) => item.run.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  );

  const refresh = async () => {
    const next = await api.listAgentRuns(16);
    setRuns(next);
    setSelectedRunId((current) =>
      current && next.some((item) => item.run.id === current) ? current : next[0]?.run.id ?? "",
    );
  };

  useEffect(() => {
    void refresh().catch((e) => setError(formatError(e)));
  }, []);

  const createRun = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedGoal = goal.trim();
    if (!trimmedGoal || busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await api.createAgentRun({
        treeId,
        nodeId,
        title: title.trim() || null,
        goal: trimmedGoal,
      });
      setRuns((current) => [created, ...current.filter((item) => item.run.id !== created.run.id)]);
      setSelectedRunId(created.run.id);
      setGoal("");
      setTitle("");
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const stepRun = async (runId: string) => {
    if (steppingRunId) return;
    setSteppingRunId(runId);
    setError("");
    try {
      const updated = await api.advanceAgentRun(runId, crypto.randomUUID());
      setRuns((current) => current.map((item) => (item.run.id === runId ? updated : item)));
      setSelectedRunId(updated.run.id);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setSteppingRunId("");
    }
  };

  return (
    <aside className="no-drag fixed left-3 right-3 top-12 z-50 max-h-[calc(100vh-64px)] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)]/95 shadow-[0_12px_40px_rgba(0,0,0,0.14)] backdrop-blur-xl lg:left-auto lg:right-3 lg:w-[820px]">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[color:var(--text)]">Tasks</div>
          <div className="truncate text-xs text-[color:var(--muted)]">
            Restartable agent runs with persisted atomic progress
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

      <div className="grid max-h-[calc(100vh-122px)] gap-4 overflow-y-auto p-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <form
            onSubmit={createRun}
            className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3"
          >
            <div className="text-xs font-semibold text-[color:var(--text)]">New run</div>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={inputClass}
              placeholder="Title"
            />
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              className={`${inputClass} h-24 resize-none py-2`}
              placeholder="Goal or PRD"
            />
            <button
              type="submit"
              disabled={busy || !goal.trim()}
              className="mt-2 h-9 w-full rounded-full bg-[color:var(--button)] px-4 text-xs font-medium text-[color:var(--button-text)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Planning" : "Create PRD + tasks"}
            </button>
          </form>

          <div className="space-y-2">
            {runs.length === 0 ? (
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-3 text-sm text-[color:var(--muted)]">
                No agent runs yet.
              </div>
            ) : (
              runs.map((item) => {
                const active = item.run.id === selected?.run.id;
                return (
                  <button
                    key={item.run.id}
                    type="button"
                    onClick={() => setSelectedRunId(item.run.id)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? "border-[color:var(--accent)] bg-[color:var(--selected)]"
                        : "border-[color:var(--border)] bg-[color:var(--app-bg)] hover:bg-[color:var(--panel-soft)]"
                    }`}
                  >
                    <span className="block truncate text-sm font-semibold text-[color:var(--text)]">
                      {item.run.title}
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[color:var(--muted)]">
                      <span>{item.run.status}</span>
                      <span>{doneCount(item)}/{item.tasks.length}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          {error && <div className="text-xs text-red-600">{error}</div>}
          {!selected ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-3 text-sm text-[color:var(--muted)]">
              Create or select a run.
            </div>
          ) : (
            <>
              <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[color:var(--text)]">
                      {selected.run.title}
                    </div>
                    <div className="mt-1 line-clamp-3 text-xs leading-5 text-[color:var(--muted)]">
                      {selected.run.goal}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={steppingRunId === selected.run.id || selected.run.status === "completed"}
                    onClick={() => void stepRun(selected.run.id)}
                    className="h-9 rounded-full bg-[color:var(--button)] px-4 text-xs font-medium text-[color:var(--button-text)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {steppingRunId === selected.run.id ? "Running step" : "Run next task"}
                  </button>
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-[color:var(--muted)]">
                    PRD and specs
                  </summary>
                  <div className="mt-2 rounded-lg border border-[color:var(--border)] px-3 py-2 text-xs leading-5 text-[color:var(--muted)]">
                    <div className="whitespace-pre-wrap">{selected.run.prd}</div>
                    <div className="mt-3 space-y-1">
                      {selected.run.specs.map((spec, index) => (
                        <div key={`${index}-${spec}`}>- {spec}</div>
                      ))}
                    </div>
                  </div>
                </details>
              </section>

              <section className="space-y-2">
                {selected.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[color:var(--text)]">
                          {task.position}. {task.title}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-[color:var(--muted)]">
                          {task.description}
                        </div>
                      </div>
                      <span className={statusClass(task.status)}>{task.status}</span>
                    </div>
                    {(task.result || task.error) && (
                      <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-[color:var(--code-bg)] p-2 text-[11px] leading-4 text-[color:var(--code-text)]">
                        {task.result || task.error}
                      </pre>
                    )}
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

const inputClass =
  "mt-2 min-h-9 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] px-3 text-sm text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted)] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.035)]";

function doneCount(detail: AgentRunDetail) {
  return detail.tasks.filter((task) => task.status === "done").length;
}

function statusClass(status: string) {
  const base = "shrink-0 rounded-full px-2 py-1 text-[11px]";
  if (status === "done") return `${base} bg-emerald-500/12 text-emerald-700`;
  if (status === "failed" || status === "blocked") return `${base} bg-red-500/12 text-red-700`;
  if (status === "in_progress") return `${base} bg-amber-500/12 text-amber-700`;
  return `${base} border border-[color:var(--border)] text-[color:var(--muted)]`;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
