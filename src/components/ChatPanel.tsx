import {
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  api,
  isTauriRuntime,
  type Message,
  type QuizAttempt,
} from "../lib/api";
import type { CanvasLayoutNode } from "./TreeCanvas";
import { MarkdownMessage } from "./MarkdownMessage";
import { QuizBlock } from "./QuizBlock";

interface ChatPanelProps {
  selectedNode: CanvasLayoutNode | null;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  streamingText: string;
  canWrite: boolean;
  canStartChat?: boolean;
  fullWidth: boolean;
  error: string;
  panelWidth?: number;
  onSend: (content: string) => Promise<void>;
  onStartChat?: (content: string) => Promise<void>;
  onEditMessage: (message: Message, content: string) => Promise<void>;
  onRegenerateMessage: (message: Message) => Promise<void>;
  onConfirmBranches: (message: Message) => Promise<void>;
  onForceBranchSplit: (content: string) => Promise<void>;
}

interface AttachmentDraft {
  id: string;
  name: string;
  size: number;
  type: string;
  content: string;
  warning?: string;
}

const MAX_ATTACHMENTS = 8;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 180_000;
const BRANCH_PLAN_ACTION_MARKER = "<!-- treeai:branch-plan -->";
const HOME_INSTITUTIONS = ["MIPT", "MSU", "HSE", "MEPhI", "ITMO", "NSU"] as const;
const TYPE_SPEED_MS = 72;
const DELETE_SPEED_MS = 42;
const HOLD_TYPED_MS = 1150;
const HOLD_EMPTY_MS = 180;

export function ChatPanel({
  selectedNode,
  messages,
  loading,
  sending,
  streamingText,
  canWrite,
  canStartChat = false,
  fullWidth,
  error,
  panelWidth,
  onSend,
  onStartChat,
  onEditMessage,
  onRegenerateMessage,
  onConfirmBranches,
  onForceBranchSplit,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [branchMode, setBranchMode] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [branchActionBusy, setBranchActionBusy] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [quizAttempts, setQuizAttempts] = useState<Record<string, QuizAttempt[]>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastMessage = messages[messages.length - 1];
  const scrollAnchor = `${messages.length}:${lastMessage?.id ?? ""}:${
    lastMessage?.content.length ?? 0
  }:${streamingText.length}:${sending}:${loading}`;

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      scrollElement.scrollTop = scrollElement.scrollHeight;
      secondFrame = requestAnimationFrame(() => {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      });
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [scrollAnchor]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(200, Math.max(48, textarea.scrollHeight))}px`;
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedNode) {
      setQuizAttempts({});
      return () => {
        cancelled = true;
      };
    }
    api
      .getQuizAttempts(selectedNode.treeId, selectedNode.id)
      .then((attempts) => {
        if (cancelled) return;
        setQuizAttempts(groupQuizAttemptsByMessage(attempts));
      })
      .catch(() => {
        if (!cancelled) setQuizAttempts({});
      });
    return () => {
      cancelled = true;
    };
  }, [messages.length, selectedNode?.id, selectedNode?.treeId]);

  const composerWritable = Boolean((selectedNode && canWrite) || (!selectedNode && canStartChat));
  const canSend = Boolean(composerWritable && !sending && (draft.trim() || attachments.length > 0));
  const canToggleBranchMode = Boolean(selectedNode && canWrite && !sending && !attachmentBusy);

  const attachFiles = async (files: FileList | null) => {
    if (!files?.length || !composerWritable || sending) return;
    setAttachmentBusy(true);
    setAttachmentError("");
    try {
      const loaded: AttachmentDraft[] = [];
      const failed: string[] = [];
      const slotsLeft = MAX_ATTACHMENTS - attachments.length;
      const candidates = Array.from(files).slice(0, Math.max(0, slotsLeft));

      if (slotsLeft <= 0) {
        setAttachmentError(`Maximum ${MAX_ATTACHMENTS} files per message.`);
        return;
      }
      if (files.length > slotsLeft) {
        failed.push(`Only ${slotsLeft} more file${slotsLeft === 1 ? "" : "s"} can be attached.`);
      }

      for (const file of candidates) {
        try {
          loaded.push(await readFileAsAttachment(file));
        } catch (e) {
          failed.push(`${file.name}: ${formatError(e)}`);
        }
      }

      if (loaded.length > 0) {
        setAttachments((current) => [...current, ...loaded]);
      }
      if (failed.length > 0) {
        setAttachmentError(failed.join("\n"));
      }
    } finally {
      setAttachmentBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDropActive(false);
    void attachFiles(event.dataTransfer.files);
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((file) => file.id !== id));
  };

  const startEditingMessage = (message: Message) => {
    setEditingMessage(message);
    setBranchMode(false);
    setAttachments([]);
    setDraft(stripBranchPlanAction(message.content));
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const cancelEditing = () => {
    setEditingMessage(null);
    setDraft("");
    setAttachments([]);
  };

  const copyMessage = async (message: Message) => {
    const content = stripBranchPlanAction(message.content);
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === message.id ? "" : current));
      }, 1200);
    } catch (e) {
      setAttachmentError(formatError(e));
    }
  };

  const submitMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!composerWritable || sending) return;

    const content = buildMessageContent(draft, attachments);
    if (!content) return;

    setDraft("");
    setAttachments([]);
    setBranchMode(false);
    if (!selectedNode) {
      await onStartChat?.(content);
      return;
    }
    if (editingMessage) {
      setEditingMessage(null);
      await onEditMessage(editingMessage, content);
      return;
    }
    if (branchMode) {
      await onForceBranchSplit(content);
      return;
    }
    await onSend(content);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  };

  const contentShell = "mx-auto min-w-0";
  const composerShell = "mx-auto min-w-0";
  const contentShellStyle = { width: "min(760px, calc(100vw - 48px))", maxWidth: "100%" };
  const composerShellStyle = { width: "min(780px, calc(100vw - 48px))", maxWidth: "100%" };
  const assistantWidth = "max-w-[760px]";
  const userWidth = "max-w-[70%]";
  const panelStyle = fullWidth || !panelWidth ? undefined : { width: `${panelWidth}px` };
  const showEmptyState = !loading && messages.length === 0 && !streamingText;
  const errorBlock = (error || attachmentError) && (
    <div className="text-xs text-red-300">
      <div
        className={`${composerShell} space-y-1 whitespace-pre-wrap break-words`}
        style={composerShellStyle}
      >
        {error && <div className="text-red-600">{error}</div>}
        {attachmentError && <div className="text-red-600">{attachmentError}</div>}
      </div>
    </div>
  );
  const composerForm = (
    <form
      onSubmit={submitMessage}
      onDrop={handleDrop}
      onDragOver={(event) => {
        if (!composerWritable || sending) return;
        event.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && event.currentTarget.contains(nextTarget)) return;
        setDropActive(false);
      }}
      className={showEmptyState ? "w-full" : "bg-[color:var(--app-bg)] px-6 pb-6 pt-2"}
    >
      <div className={composerShell} style={composerShellStyle}>
        {!canWrite && selectedNode && (
          <div className="mb-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-2 text-xs text-[color:var(--muted)]">
            Select or create a leaf branch to write.
          </div>
        )}
        {editingMessage && (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-2 text-xs text-[color:var(--muted)]">
            <span className="truncate">Editing your message</span>
            <button
              type="button"
              onClick={cancelEditing}
              className="shrink-0 rounded-full px-2 py-1 text-[color:var(--text)] hover:bg-[color:var(--selected)]"
            >
              Cancel
            </button>
          </div>
        )}

        <div
          className={`overflow-hidden rounded-[24px] border p-3 shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-[background-color,border-color,box-shadow] focus-within:shadow-[0_1px_3px_rgba(0,0,0,0.08),0_0_0_3px_rgba(0,0,0,0.035)] ${
            dropActive
              ? "border-[color:var(--border)] bg-[color:var(--panel-soft)]"
              : "border-[color:var(--border)] bg-[color:var(--panel)]"
          }`}
        >
          {(attachments.length > 0 || attachmentBusy) && (
            <div className="mb-2 flex max-h-24 gap-2 overflow-x-auto">
              {attachments.map((file) => (
                <div
                  key={file.id}
                  className="inline-flex h-8 max-w-[240px] shrink-0 items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 text-xs text-[color:var(--muted)]"
                  title={file.warning || file.name}
                >
                  <span className="min-w-0 truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(file.id)}
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[color:var(--muted)] hover:bg-[color:var(--selected)] hover:text-[color:var(--text)]"
                    aria-label={`Remove ${file.name}`}
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
              {attachmentBusy && (
                <div className="inline-flex h-8 shrink-0 items-center rounded-full border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 text-xs text-[color:var(--muted)]">
                  Loading files
                </div>
              )}
            </div>
          )}
          <div className="px-1 pt-1">
            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              disabled={!composerWritable || sending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              className="max-h-[200px] min-h-[48px] w-full resize-none bg-transparent px-0 py-1 text-[15px] leading-6 text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={
                selectedNode
                  ? canWrite
                    ? editingMessage
                      ? "Edit your prompt"
                      : "Ask anything"
                    : "Parent branches are read-only"
                  : "Ask anything"
              }
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => void attachFiles(event.target.files)}
              />
              <button
                type="button"
                disabled={!composerWritable || sending || attachmentBusy}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[color:var(--border)] bg-transparent p-0 text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={attachmentBusy ? "Loading files" : "Attach files"}
              >
                {attachmentBusy ? (
                  <span className="text-xs leading-none">...</span>
                ) : (
                  <PlusIcon />
                )}
              </button>
              <button
                type="button"
                disabled={!canToggleBranchMode || Boolean(editingMessage)}
                onClick={() => setBranchMode((value) => !value)}
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border p-0 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  branchMode
                    ? "border-[color:var(--button)] bg-[color:var(--button)] text-[color:var(--button-text)]"
                    : "border-[color:var(--border)] bg-transparent text-[color:var(--text)] hover:bg-[color:var(--selected)]"
                }`}
                aria-label={branchMode ? "Cancel branch split after sending" : "Split into branches after sending"}
                aria-pressed={branchMode}
                title={branchMode ? "Split into branches after sending" : "Split into branches after sending"}
              >
                <BranchSplitIcon />
              </button>
            </div>
            <button
              type="submit"
              disabled={!canSend}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0 bg-[color:var(--button)] p-0 text-[color:var(--button-text)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
              aria-label="Send"
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </form>
  );

  return (
    <aside
      style={panelStyle}
      className={`no-drag flex min-h-0 min-w-0 flex-col overflow-hidden bg-[color:var(--app-bg)] text-[color:var(--text)] ${
        fullWidth
          ? "h-auto flex-1 w-full border-l-0"
          : "h-full shrink-0 border-l border-[color:var(--border)]"
      }`}
    >
      {showEmptyState ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-16 pt-10">
          <HomeHeroTitle />
          <div className="w-full space-y-3">
            {errorBlock}
            {composerForm}
          </div>
        </div>
      ) : (
        <>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pb-7 pt-5">
        {loading ? (
          <div className={`${contentShell} text-sm text-[color:var(--muted)]`} style={contentShellStyle}>
            Loading
          </div>
        ) : messages.length === 0 && !streamingText ? (
          <div
            className={`${contentShell} flex min-h-full items-center justify-center text-center text-sm text-[color:var(--muted)]`}
            style={contentShellStyle}
          >
            {selectedNode ? "Empty node" : "No node selected"}
          </div>
        ) : (
          <div className={`${contentShell} space-y-7`} style={contentShellStyle}>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={
                    message.role === "user"
                      ? `${userWidth} min-w-0 break-words rounded-3xl bg-[color:var(--user)] px-4 py-3 text-[15px] leading-7 text-[color:var(--text)]`
                      : `${assistantWidth} min-w-0 break-words text-[15px] leading-7 text-[color:var(--text)]`
                  }
                >
                  <MessageContent
                    message={message}
                    quizAttempts={quizAttempts[message.id] ?? []}
                    onSaveQuizAttempt={async (
                      quizId,
                      quizType,
                      answerJson,
                      isCorrect,
                      score,
                      maxScore,
                      explanation,
                    ) => {
                      const attempt = await api.saveQuizAttempt(
                        message.tree_id,
                        message.node_id,
                        message.id,
                        quizId,
                        quizType,
                        answerJson,
                        isCorrect,
                        score,
                        maxScore,
                        explanation,
                      );
                      setQuizAttempts((current) => ({
                        ...current,
                        [message.id]: latestQuizAttempts([...(current[message.id] ?? []), attempt]),
                      }));
                      return attempt;
                    }}
                  />
                  {message.role === "assistant" && hasBranchPlanAction(message.content) && (
                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={sending || branchActionBusy === message.id}
                        onClick={async () => {
                          setBranchActionBusy(message.id);
                          try {
                            await onConfirmBranches(message);
                          } finally {
                            setBranchActionBusy("");
                          }
                        }}
                        className="inline-flex h-9 items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--panel)] px-3 text-sm font-medium text-[color:var(--text)] shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-colors hover:bg-[color:var(--selected)] disabled:cursor-not-allowed disabled:opacity-45"
                        aria-label="Split into branches"
                        title="Split into branches"
                      >
                        <CheckIcon />
                        <span>Split into branches</span>
                      </button>
                    </div>
                  )}
                  <MessageActions
                    message={message}
                    canMutate={Boolean(canWrite && message.node_id === selectedNode?.id)}
                    copied={copiedMessageId === message.id}
                    sending={sending}
                    onCopy={() => void copyMessage(message)}
                    onEdit={() => startEditingMessage(message)}
                    onRegenerate={() => void onRegenerateMessage(message)}
                  />
                </div>
              </div>
            ))}
            {streamingText && (
              <div className="flex justify-start">
                <div
                  className={`${assistantWidth} min-w-0 break-words text-[15px] leading-7 text-[color:var(--text)]`}
                >
                  <StreamingMessage content={streamingText} />
                </div>
              </div>
            )}
            {sending && !streamingText && (
              <div className="flex justify-start">
                <div className="rounded-full border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-2 text-sm text-[color:var(--muted)]">
                  Thinking
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {errorBlock && <div className="px-6 pb-2">{errorBlock}</div>}
      {composerForm}
        </>
      )}
    </aside>
  );
}

function HomeHeroTitle() {
  const [institutionIndex, setInstitutionIndex] = useState(0);
  const [characterCount, setCharacterCount] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const institution = HOME_INSTITUTIONS[institutionIndex];
  const typedInstitution = institution.slice(0, characterCount);

  useEffect(() => {
    const complete = characterCount === institution.length;
    const empty = characterCount === 0;
    const delay = complete
      ? HOLD_TYPED_MS
      : empty && deleting
        ? HOLD_EMPTY_MS
        : deleting
          ? DELETE_SPEED_MS
          : TYPE_SPEED_MS;

    const timer = window.setTimeout(() => {
      if (!deleting && complete) {
        setDeleting(true);
        return;
      }
      if (deleting && empty) {
        setDeleting(false);
        setInstitutionIndex((index) => (index + 1) % HOME_INSTITUTIONS.length);
        return;
      }
      setCharacterCount((count) => count + (deleting ? -1 : 1));
    }, delay);

    return () => window.clearTimeout(timer);
  }, [characterCount, deleting, institution.length]);

  return (
    <div
      className="mb-7 max-w-full text-center text-[26px] font-semibold leading-tight text-[color:var(--text)] sm:text-[30px]"
      aria-label={`ino-agent for ${institution}`}
    >
      <span>ino-agent for </span>
      <span className="inline-block min-w-[5ch] text-left">
        <span>{typedInstitution}</span>
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-[0.9em] w-[2px] translate-y-[2px] animate-pulse rounded-full bg-[color:var(--text)]"
        />
      </span>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      className="block h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.9"
      viewBox="0 0 24 24"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      aria-hidden="true"
      className="block h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.1"
      viewBox="0 0 24 24"
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

function BranchSplitIcon() {
  return (
    <svg
      aria-hidden="true"
      className="block h-[17px] w-[17px]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
      viewBox="0 0 24 24"
    >
      <path d="M12 4v5" />
      <path d="M7 20v-5a5 5 0 0 1 5-5" />
      <path d="M17 20v-5a5 5 0 0 0-5-5" />
      <path d="M5 20h4" />
      <path d="M15 20h4" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
      viewBox="0 0 24 24"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
      viewBox="0 0 24 24"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function RegenerateIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
      viewBox="0 0 24 24"
    >
      <path d="M3 12a9 9 0 0 1 15.1-6.6" />
      <path d="M18 2v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.1 6.6" />
      <path d="M6 22v-5h5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.9"
      viewBox="0 0 24 24"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.2"
      viewBox="0 0 24 24"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

async function readFileAsAttachment(file: File): Promise<AttachmentDraft> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File is larger than ${formatBytes(MAX_FILE_BYTES)}.`);
  }

  const textLike =
    file.type.startsWith("text/") ||
    /\.(md|markdown|txt|csv|json|jsonl|tsv|tex|js|jsx|ts|tsx|py|rs|html|css|xml|yaml|yml|log)$/i.test(
      file.name,
    );

  if (textLike) {
    const text = await readFileText(file);
    const clipped =
      text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[File clipped]` : text;
    return {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.type || "text",
      content: clipped,
      warning: text.length > MAX_TEXT_CHARS ? "File clipped before sending" : undefined,
    };
  }

  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    const text = isTauriRuntime()
      ? await api.extractPdfText(Array.from(new Uint8Array(await file.arrayBuffer())))
      : await extractPdfTextFallback(file);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: "application/pdf",
      content: text.trim() || "[PDF text extraction returned no readable text.]",
      warning: text
        ? "PDF text extracted"
        : "Could not extract PDF text",
    };
  }

  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    type: file.type || "unknown",
    content: `[Binary file attached: ${file.name}, ${file.type || "unknown"}, ${file.size} bytes. Text extraction is not available for this type yet.]`,
    warning: "Only metadata will be sent for this file type",
  };
}

function MessageContent({
  message,
  quizAttempts,
  onSaveQuizAttempt,
}: {
  message: Message;
  quizAttempts: QuizAttempt[];
  onSaveQuizAttempt: (
    quizId: string,
    quizType: string,
    answerJson: string,
    isCorrect: boolean,
    score: number,
    maxScore: number,
    explanation: string,
  ) => Promise<QuizAttempt>;
}) {
  const content = message.content;
  const { visibleText, attachments } = splitAttachmentPayload(stripBranchPlanAction(content));
  const renderQuiz =
    message.role === "assistant"
      ? (source: string) => (
          <QuizBlock
            source={source}
            attempts={quizAttempts}
            onSaveAttempt={onSaveQuizAttempt}
          />
        )
      : undefined;
  return (
    <>
      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              key={`${attachment.name}-${attachment.index}`}
              className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 text-[13px] leading-none text-[color:var(--muted)]"
            >
              <span className="max-w-[260px] truncate">{attachment.name}</span>
              <span className="text-[color:var(--muted)]">·</span>
              <span className="max-w-[180px] truncate">{attachment.meta}</span>
            </div>
          ))}
        </div>
      )}
      {visibleText && (
        <MarkdownMessage
          content={visibleText}
          renderQuiz={renderQuiz}
        />
      )}
    </>
  );
}

function MessageActions({
  message,
  canMutate,
  copied,
  sending,
  onCopy,
  onEdit,
  onRegenerate,
}: {
  message: Message;
  canMutate: boolean;
  copied: boolean;
  sending: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
}) {
  const align = message.role === "user" ? "justify-end" : "justify-start";
  const canEdit = message.role === "user" && canMutate;
  const canRegenerate = message.role === "assistant" && canMutate;

  return (
    <div className={`mt-2 flex ${align} gap-1 opacity-70 transition-opacity group-hover/message:opacity-100`}>
      {canEdit && (
        <ActionIconButton
          label="Edit"
          disabled={sending}
          onClick={onEdit}
        >
          <EditIcon />
        </ActionIconButton>
      )}
      <ActionIconButton
        label={copied ? "Copied" : "Copy"}
        disabled={false}
        onClick={onCopy}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </ActionIconButton>
      {canRegenerate && (
        <ActionIconButton
          label="Regenerate"
          disabled={sending}
          onClick={onRegenerate}
        >
          <RegenerateIcon />
        </ActionIconButton>
      )}
    </div>
  );
}

function ActionIconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function hasBranchPlanAction(content: string) {
  return content.includes(BRANCH_PLAN_ACTION_MARKER);
}

function stripBranchPlanAction(content: string) {
  return content.replace(BRANCH_PLAN_ACTION_MARKER, "").trim();
}

function StreamingMessage({ content }: { content: string }) {
  const normalized = content.replace(/\r\n?/g, "\n").trimStart();
  const { stable, pending } = splitStableStreamingMarkdown(normalized);
  const renderQuiz = (source: string) => (
    <QuizBlock
      source={source}
      attempts={[]}
      onSaveAttempt={async (
        quizId,
        quizType,
        answerJson,
        isCorrect,
        score,
        maxScore,
        explanation,
      ) => ({
        id: `streaming-${quizId}`,
        tree_id: "",
        node_id: "",
        message_id: "",
        quiz_id: quizId,
        quiz_type: quizType,
        answer_json: answerJson,
        is_correct: isCorrect,
        score,
        max_score: maxScore,
        explanation,
        created_at: Date.now(),
      })}
    />
  );

  return (
    <div className="text-[15px] leading-7 text-[color:var(--text)]">
      {stable && <MarkdownMessage content={stable} renderQuiz={renderQuiz} />}
      {pending && (
        <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-[color:var(--text)]">
          {pending}
        </div>
      )}
      <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse rounded-full bg-[color:var(--muted)]" />
    </div>
  );
}

function splitStableStreamingMarkdown(content: string) {
  let openFence: { marker: "`" | "~"; length: number; start: number } | null = null;
  let lineStart = 0;

  while (lineStart <= content.length) {
    const lineEnd = content.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? content.length : lineEnd;
    const line = content.slice(lineStart, end);
    const fence = parseFenceLine(line);

    if (fence) {
      if (!openFence) {
        openFence = { ...fence, start: lineStart };
      } else if (fence.marker === openFence.marker && fence.length >= openFence.length) {
        openFence = null;
      }
    }

    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }

  if (!openFence) {
    return { stable: content, pending: "" };
  }
  return {
    stable: content.slice(0, openFence.start).trimEnd(),
    pending: content.slice(openFence.start),
  };
}

function parseFenceLine(line: string): { marker: "`" | "~"; length: number } | null {
  const match = /^(?: {0,3})(`{3,}|~{3,})/.exec(line);
  if (!match) return null;
  const marker = match[1][0] as "`" | "~";
  return { marker, length: match[1].length };
}

function splitAttachmentPayload(content: string) {
  const attachments: Array<{ index: number; name: string; meta: string }> = [];
  let index = 0;
  const visibleText = content
    .replace(
      /\[Attached file: ([\s\S]*?)\]\n\n(```|~~~~)text\n[\s\S]*?\n\2/g,
      (_match, descriptor: string) => {
        const parsed = descriptor.match(/^(.+?) \((.+)\)(?:\nNote: (.+))?$/);
        attachments.push({
          index,
          name: parsed?.[1] ?? descriptor,
          meta: parsed?.[3] ? `${parsed[2]} · ${parsed[3]}` : parsed?.[2] ?? "Attached file",
        });
        index += 1;
        return "";
      },
    )
    .trim();
  return { visibleText, attachments };
}

function groupQuizAttemptsByMessage(attempts: QuizAttempt[]) {
  return attempts.reduce<Record<string, QuizAttempt[]>>((acc, attempt) => {
    acc[attempt.message_id] = latestQuizAttempts([...(acc[attempt.message_id] ?? []), attempt]);
    return acc;
  }, {});
}

function latestQuizAttempts(attempts: QuizAttempt[]) {
  return Object.values(
    attempts.reduce<Record<string, QuizAttempt>>((acc, attempt) => {
      const existing = acc[attempt.quiz_id];
      if (!existing || existing.created_at <= attempt.created_at) {
        acc[attempt.quiz_id] = attempt;
      }
      return acc;
    }, {}),
  );
}

async function extractPdfTextFallback(file: File) {
  const buffer = await file.arrayBuffer();
  const raw = new TextDecoder("latin1").decode(buffer);
  const chunks = new Set<string>();

  for (const match of raw.matchAll(/\((?:\\.|[^\\)]){6,}\)/g)) {
    const value = match[0]
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n")
      .replace(/\\t/g, " ")
      .replace(/\\([()\\])/g, "$1")
      .trim();
    if (looksReadable(value)) {
      chunks.add(value);
    }
  }

  for (const match of raw.matchAll(/[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9 ,.;:!?()\-\n]{24,}/g)) {
    const value = match[0].replace(/\s+/g, " ").trim();
    if (looksReadable(value)) {
      chunks.add(value);
    }
  }

  return Array.from(chunks).join("\n").slice(0, MAX_TEXT_CHARS).trim();
}

function looksReadable(value: string) {
  if (value.length < 12) return false;
  const letters = Array.from(value).filter((ch) => /[A-Za-zА-Яа-яЁё]/.test(ch)).length;
  return letters / value.length > 0.25;
}

function buildMessageContent(draft: string, attachments: AttachmentDraft[]) {
  const text = draft.trim();
  const files = attachments.map((file) => {
    const warning = file.warning ? `\nNote: ${file.warning}` : "";
    const fence = file.content.includes("```") ? "~~~~" : "```";
    return `[Attached file: ${file.name} (${file.type || "unknown"}, ${formatBytes(
      file.size,
    )})${warning}]\n\n${fence}text\n${file.content}\n${fence}`;
  });
  return [text, ...files].filter(Boolean).join("\n\n").trim();
}

async function readFileText(file: File) {
  try {
    return await file.text();
  } catch {
    const buffer = await file.arrayBuffer();
    return new TextDecoder().decode(buffer);
  }
}

function formatError(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}
