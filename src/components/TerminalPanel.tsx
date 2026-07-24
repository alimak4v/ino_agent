import { type FormEvent, useEffect, useState } from "react";
import {
  api,
  type TerminalCommandHistoryItem,
  type TerminalCommandResult,
  type TerminalCommandSafety,
} from "../lib/api";

interface TerminalPanelProps {
  onClose: () => void;
  windowed?: boolean;
}

export function TerminalPanel({ onClose: _onClose, windowed = false }: TerminalPanelProps) {
  const [command, setCommand] = useState("git status --short");
  const [cwd, setCwd] = useState(".");
  const [timeoutMs, setTimeoutMs] = useState(12000);
  const [safety, setSafety] = useState<TerminalCommandSafety | null>(null);
  const [pendingApproval, setPendingApproval] = useState<TerminalCommandSafety | null>(null);
  const [history, setHistory] = useState<TerminalCommandHistoryItem[]>([]);
  const [result, setResult] = useState<TerminalCommandResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refreshHistory = async () => {
    setHistory(await api.listTerminalHistory(30));
  };

  useEffect(() => {
    void refreshHistory().catch((e) => setError(formatError(e)));
  }, []);

  useEffect(() => {
    const trimmed = command.trim();
    if (!trimmed) {
      setSafety(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api
        .assessTerminalCommand({ command: trimmed, cwd, timeoutMs })
        .then((next) => {
          if (!cancelled) {
            setSafety(next);
            setError("");
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setSafety(null);
            setError(formatError(e));
          }
        });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [command, cwd, timeoutMs]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const currentSafety =
      safety ?? (await api.assessTerminalCommand({ command, cwd, timeoutMs }));
    if (currentSafety.blocked) {
      setError(currentSafety.blockReason || "Command is blocked.");
      return;
    }
    if (currentSafety.requiresApproval) {
      setPendingApproval(currentSafety);
      return;
    }
    await run(false);
  };

  const run = async (approved: boolean) => {
    if (busy || !command.trim()) return;
    setBusy(true);
    setError("");
    setPendingApproval(null);
    try {
      const next = await api.runTerminalCommand({
        command,
        cwd,
        timeoutMs,
        approved,
      });
      setResult(next);
      await refreshHistory();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const repeat = (item: TerminalCommandHistoryItem) => {
    setCommand(item.command);
    setCwd(item.cwd || ".");
    setTimeoutMs(Math.max(1000, Math.min(60000, item.durationMs || 12000)));
    setResult({
      command: item.command,
      cwd: item.cwd,
      approved: item.approved,
      safety: {
        command: item.command,
        cwd: item.cwd,
        requiresApproval: item.requiresApproval,
        reasons: item.reasons,
        blocked: false,
        blockReason: null,
      },
      success: item.success,
      stdout: item.stdout,
      stderr: item.stderr,
      exitCode: item.exitCode,
      durationMs: item.durationMs,
      timedOut: item.timedOut,
      diagnosis: item.diagnosis,
    });
  };

  return (
    <aside
      className={
        windowed
          ? "no-drag flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden bg-[color:var(--panel)]"
          : "no-drag fixed left-3 right-3 top-12 z-50 max-h-[calc(100vh-64px)] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] shadow-[0_12px_40px_rgba(0,0,0,0.14)] lg:left-auto lg:right-3 lg:w-[860px]"
      }
    >
      <div
        className={`overflow-y-auto p-6 ${
          windowed ? "min-h-0 flex-1" : "max-h-[calc(100vh-122px)]"
        }`}
      >
        <div className="mx-auto grid w-full max-w-[980px] gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="lg:col-span-2 text-sm text-[color:var(--muted)]">
          Safe workspace commands with approval, history and diagnostics
        </div>
        <div className="min-w-0 space-y-3">
          <form
            onSubmit={(event) => void submit(event)}
            className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3"
          >
            <label className="block text-xs text-[color:var(--muted)]">
              Command
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                className={inputClass}
                spellCheck={false}
              />
            </label>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
              <label className="block text-xs text-[color:var(--muted)]">
                cwd
                <input
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                  className={inputClass}
                  spellCheck={false}
                />
              </label>
              <label className="block text-xs text-[color:var(--muted)]">
                timeout ms
                <input
                  type="number"
                  min={1000}
                  max={60000}
                  step={1000}
                  value={timeoutMs}
                  onChange={(event) => setTimeoutMs(Number(event.target.value) || 12000)}
                  className={inputClass}
                />
              </label>
            </div>

            {safety && (
              <div className="mt-3 rounded-lg border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--muted)]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={safety.requiresApproval ? warnBadgeClass : okBadgeClass}>
                    {safety.blocked
                      ? "blocked"
                      : safety.requiresApproval
                        ? "approval required"
                        : "safe"}
                  </span>
                  <span className="font-mono">{safety.cwd || "."}</span>
                </div>
                {safety.reasons.length > 0 && (
                  <div className="mt-2">{safety.reasons.join(", ")}</div>
                )}
                {safety.blockReason && <div className="mt-2 text-red-600">{safety.blockReason}</div>}
              </div>
            )}

            {error && <div className="mt-3 text-xs text-red-600">{error}</div>}

            <div className="mt-3 flex justify-end">
              <button
                type="submit"
                disabled={busy || !command.trim()}
                className="h-9 rounded-full bg-[color:var(--button)] px-4 text-xs font-medium text-[color:var(--button-text)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Running" : "Run"}
              </button>
            </div>
          </form>

          {pendingApproval && (
            <section className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
              <div className="text-sm font-semibold text-[color:var(--text)]">Approval required</div>
              <div className="mt-1 text-xs leading-5 text-[color:var(--muted)]">
                {pendingApproval.reasons.join(", ")}
              </div>
              <pre className="mt-2 overflow-auto rounded-lg bg-[color:var(--code-bg)] p-2 text-[11px] text-[color:var(--code-text)]">
                {pendingApproval.command}
              </pre>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingApproval(null)}
                  className="h-8 rounded-full px-3 text-xs text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void run(true)}
                  className="h-8 rounded-full bg-[color:var(--button)] px-3 text-xs font-medium text-[color:var(--button-text)]"
                >
                  Approve and run
                </button>
              </div>
            </section>
          )}

          {result && (
            <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 truncate font-mono text-xs text-[color:var(--text)]">
                  {result.command}
                </div>
                <span className={result.success ? okBadgeClass : badBadgeClass}>
                  {result.success ? "passed" : "failed"}
                </span>
              </div>
              {result.diagnosis && (
                <div className="mt-2 rounded-lg border border-[color:var(--border)] px-2 py-2 text-xs leading-5 text-[color:var(--muted)]">
                  {result.diagnosis}
                </div>
              )}
              <pre className="mt-2 max-h-[360px] overflow-auto rounded-lg bg-[color:var(--code-bg)] p-3 text-[11px] leading-4 text-[color:var(--code-text)]">
                {[result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join("\n") ||
                  "[no output]"}
              </pre>
            </section>
          )}
        </div>

        <div className="min-w-0 space-y-2">
          <div className="text-xs font-semibold text-[color:var(--text)]">History</div>
          {history.length === 0 ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-3 text-sm text-[color:var(--muted)]">
              No commands yet.
            </div>
          ) : (
            history.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => repeat(item)}
                className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3 text-left transition-colors hover:bg-[color:var(--panel-soft)]"
              >
                <span className="block truncate font-mono text-xs text-[color:var(--text)]">
                  {item.command}
                </span>
                <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[color:var(--muted)]">
                  <span className="truncate">{item.cwd || "."}</span>
                  <span>{item.success ? "ok" : "fail"}</span>
                </span>
              </button>
            ))
          )}
        </div>
        </div>
      </div>
    </aside>
  );
}

const inputClass =
  "mt-1 h-9 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] px-3 font-mono text-sm text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted)] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.035)]";

const okBadgeClass = "rounded-full bg-emerald-500/12 px-2 py-1 text-[11px] text-emerald-700";
const warnBadgeClass = "rounded-full bg-amber-500/12 px-2 py-1 text-[11px] text-amber-700";
const badBadgeClass = "rounded-full bg-red-500/12 px-2 py-1 text-[11px] text-red-700";

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
