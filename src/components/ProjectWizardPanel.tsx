import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  api,
  type CreatedProject,
  type ProjectCommandResult,
  type ProjectStackSummary,
} from "../lib/api";

interface ProjectWizardPanelProps {
  onClose: () => void;
  onOpenFolder: (path: string) => Promise<void>;
  onAskAgent: (prompt: string) => Promise<void>;
}

export function ProjectWizardPanel({ onClose, onOpenFolder, onAskAgent }: ProjectWizardPanelProps) {
  const [stacks, setStacks] = useState<ProjectStackSummary[]>([]);
  const [stackId, setStackId] = useState("");
  const [name, setName] = useState("my-project");
  const [path, setPath] = useState("projects/my-project");
  const [description, setDescription] = useState("");
  const [created, setCreated] = useState<CreatedProject | null>(null);
  const [commandResult, setCommandResult] = useState<ProjectCommandResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [runningKind, setRunningKind] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void api
      .listProjectStacks()
      .then((items) => {
        setStacks(items);
        setStackId((current) => current || items[0]?.id || "");
      })
      .catch((e) => setError(formatError(e)));
  }, []);

  const selectedStack = useMemo(
    () => stacks.find((stack) => stack.id === stackId) ?? stacks[0] ?? null,
    [stackId, stacks],
  );

  useEffect(() => {
    if (created) return;
    const normalized = slugify(name);
    setPath((current) => {
      if (!current.trim() || current.startsWith("projects/")) {
        return `projects/${normalized || "my-project"}`;
      }
      return current;
    });
  }, [created, name]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedStack || busy) return;
    setBusy(true);
    setError("");
    setCommandResult(null);
    try {
      const result = await api.createProject({
        name,
        stack: selectedStack.id,
        path,
        description,
      });
      setCreated(result);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const runCommand = async (kind: string) => {
    if (!created || runningKind) return;
    setRunningKind(kind);
    setError("");
    try {
      const result = await api.runProjectCommand({
        path: created.path,
        stack: created.stack,
        commandKind: kind,
      });
      setCommandResult(result);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setRunningKind("");
    }
  };

  const askAgent = async () => {
    if (!created || !selectedStack) return;
    const prompt = [
      `Проект создан через Project wizard: ${created.name}`,
      `Стек: ${selectedStack.name}`,
      `Путь: ${created.path}`,
      "",
      "Прочитай структуру проекта, предложи следующие atomic tasks и помоги довести его до рабочего состояния.",
    ].join("\n");
    await onAskAgent(prompt);
    onClose();
  };

  return (
    <aside className="no-drag fixed left-3 right-3 top-12 z-50 max-h-[calc(100vh-64px)] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] shadow-[0_12px_40px_rgba(0,0,0,0.14)] lg:left-auto lg:right-3 lg:w-[780px]">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[color:var(--text)]">Project wizard</div>
          <div className="truncate text-xs text-[color:var(--muted)]">
            Generate a starter workspace and run safe project commands
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
        <form onSubmit={submit} className="min-w-0 space-y-4">
          <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-[color:var(--muted)]">
                Project name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={inputClass}
                  placeholder="my-project"
                />
              </label>
              <label className="text-xs text-[color:var(--muted)]">
                Folder
                <input
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  className={inputClass}
                  placeholder="projects/my-project"
                />
              </label>
            </div>
            <label className="mt-3 block text-xs text-[color:var(--muted)]">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className={`${inputClass} h-20 resize-none py-2`}
                placeholder="What should this project be for?"
              />
            </label>
          </section>

          <section className="grid gap-2 sm:grid-cols-2">
            {stacks.map((stack) => {
              const active = stack.id === selectedStack?.id;
              return (
                <button
                  key={stack.id}
                  type="button"
                  onClick={() => setStackId(stack.id)}
                  className={`min-h-[96px] rounded-xl border p-3 text-left transition-colors ${
                    active
                      ? "border-[color:var(--accent)] bg-[color:var(--selected)]"
                      : "border-[color:var(--border)] bg-[color:var(--app-bg)] hover:bg-[color:var(--panel-soft)]"
                  }`}
                >
                  <span className="block text-sm font-semibold text-[color:var(--text)]">
                    {stack.name}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[color:var(--muted)]">
                    {stack.description}
                  </span>
                </button>
              );
            })}
          </section>

          {error && <div className="text-xs text-red-600">{error}</div>}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setCreated(null);
                setCommandResult(null);
                setError("");
              }}
              className="h-9 rounded-full px-3 text-xs text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)]"
            >
              Reset
            </button>
            <button
              type="submit"
              disabled={busy || !selectedStack}
              className="h-9 rounded-full bg-[color:var(--button)] px-4 text-xs font-medium text-[color:var(--button-text)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Creating" : "Create"}
            </button>
          </div>
        </form>

        <div className="min-w-0 space-y-3">
          <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[color:var(--text)]">
                  {created ? created.name : selectedStack?.name ?? "No stack"}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-[color:var(--muted)]">
                  {created?.path ?? path}
                </div>
              </div>
              {created && (
                <div className="rounded-full border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]">
                  {created.files.length} files
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!created}
                onClick={() => created && void onOpenFolder(created.absolutePath)}
                className={smallButtonClass}
              >
                Open Folder
              </button>
              <button
                type="button"
                disabled={!created}
                onClick={() => void askAgent()}
                className={smallButtonClass}
              >
                Ask Agent
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {(created?.commands ?? selectedStack?.commands ?? []).map((command) => (
                <button
                  key={command.kind}
                  type="button"
                  disabled={!created || Boolean(runningKind)}
                  onClick={() => void runCommand(command.kind)}
                  className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-[color:var(--border)] px-3 py-2 text-left transition-colors hover:bg-[color:var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="text-xs font-medium text-[color:var(--text)]">
                    {runningKind === command.kind ? "Running" : command.label}
                  </span>
                  <span className="min-w-0 truncate font-mono text-[11px] text-[color:var(--muted)]">
                    {command.command}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {created && (
            <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
              <div className="mb-2 text-xs font-semibold text-[color:var(--text)]">Files</div>
              <div className="max-h-44 space-y-1 overflow-y-auto">
                {created.files.map((file) => (
                  <div
                    key={file}
                    className="truncate rounded-lg border border-[color:var(--border)] px-2 py-1 font-mono text-[11px] text-[color:var(--muted)]"
                  >
                    {file}
                  </div>
                ))}
              </div>
            </section>
          )}

          {commandResult && (
            <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 truncate font-mono text-[11px] text-[color:var(--muted)]">
                  {commandResult.command}
                </div>
                <div
                  className={`rounded-full px-2 py-1 text-[11px] ${
                    commandResult.success
                      ? "bg-emerald-500/12 text-emerald-700"
                      : "bg-red-500/12 text-red-700"
                  }`}
                >
                  {commandResult.success ? "passed" : "failed"}
                </div>
              </div>
              {commandResult.diagnosis && (
                <div className="mt-2 rounded-lg border border-[color:var(--border)] px-2 py-2 text-xs leading-5 text-[color:var(--muted)]">
                  {commandResult.diagnosis}
                </div>
              )}
              <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-[color:var(--code-bg)] p-2 text-[11px] leading-4 text-[color:var(--code-text)]">
                {[commandResult.stdout.trimEnd(), commandResult.stderr.trimEnd()]
                  .filter(Boolean)
                  .join("\n")}
              </pre>
            </section>
          )}
        </div>
      </div>
    </aside>
  );
}

const inputClass =
  "mt-1 min-h-9 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] px-3 text-sm text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted)] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.035)]";

const smallButtonClass =
  "h-8 rounded-full border border-[color:var(--border)] px-3 text-xs text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)] disabled:cursor-not-allowed disabled:opacity-50";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
