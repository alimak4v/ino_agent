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
  type AgentToolEvent,
  type AgentToolResult,
  type AgentTrace,
  type Message,
  type QuizAttempt,
} from "../lib/api";
import { uiText, type InterfaceLanguage } from "../lib/i18n";
import type { CanvasLayoutNode } from "./TreeCanvas";
import { MarkdownMessage } from "./MarkdownMessage";
import { QuizBlock } from "./QuizBlock";

interface ChatPanelProps {
  selectedNode: CanvasLayoutNode | null;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  streamingText: string;
  agentToolEvents: AgentToolEvent[];
  canWrite: boolean;
  canStartChat?: boolean;
  fullWidth: boolean;
  error: string;
  targetMessageId?: string;
  panelWidth?: number;
  language: InterfaceLanguage;
  onSend: (content: string) => Promise<void>;
  onStartChat?: (content: string) => Promise<void>;
  onStartBranchSplit?: (content: string) => Promise<void>;
  onStartConnector?: (content: string) => Promise<void>;
  onEditMessage: (message: Message, content: string) => Promise<void>;
  onRegenerateMessage: (message: Message) => Promise<void>;
  onConfirmBranches: (message: Message, titles?: string[]) => Promise<void>;
  onForceBranchSplit: (content: string) => Promise<void>;
  onProposeConnector: (content: string) => Promise<void>;
  onOpenTarget: (target: string) => Promise<void>;
}

interface AttachmentDraft {
  id: string;
  name: string;
  size: number;
  type: string;
  content: string;
  directFileData?: string;
  warning?: string;
}

type AgentMode = "auto" | "read" | "memory" | "command" | "workspace";

const MAX_ATTACHMENTS = 8;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 180_000;
const BRANCH_PLAN_ACTION_MARKER = "<!-- treeai:branch-plan -->";
const BRANCH_PLAN_PAYLOAD_FENCE = "ino-agent-branch-plan";
const AGENT_MODES: AgentMode[] = ["auto", "read", "memory", "command", "workspace"];
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
  agentToolEvents,
  canWrite,
  canStartChat = false,
  fullWidth,
  error,
  targetMessageId = "",
  panelWidth,
  language,
  onSend,
  onStartChat,
  onStartBranchSplit,
  onStartConnector,
  onEditMessage,
  onRegenerateMessage,
  onConfirmBranches,
  onForceBranchSplit,
  onProposeConnector,
  onOpenTarget,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [agentMode, setAgentMode] = useState<AgentMode>("auto");
  const [branchMode, setBranchMode] = useState(false);
  const [connectorMode, setConnectorMode] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [branchActionBusy, setBranchActionBusy] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [quizAttempts, setQuizAttempts] = useState<Record<string, QuizAttempt[]>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastMessage = messages[messages.length - 1];
  const scrollAnchor = `${messages.length}:${lastMessage?.id ?? ""}:${
    lastMessage?.content.length ?? 0
  }:${streamingText.length}:${agentToolEvents.length}:${sending}:${loading}`;

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
    if (!targetMessageId) return;
    const element = messageRefs.current[targetMessageId];
    if (!element) return;
    window.setTimeout(() => {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
  }, [messages.length, targetMessageId]);

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
  const canUseActionModes = Boolean(
    ((selectedNode && canWrite) || (!selectedNode && canStartChat)) && !sending && !attachmentBusy,
  );
  const canToggleBranchMode = canUseActionModes;
  const canToggleConnectorMode = canUseActionModes;
  const modeLabelKey: Record<AgentMode, Parameters<typeof uiText>[1]> = {
    auto: "modeAuto",
    read: "modeRead",
    memory: "modeMemory",
    command: "modeCommand",
    workspace: "modeWorkspace",
  };
  const modeTitleKey: Record<AgentMode, Parameters<typeof uiText>[1]> = {
    auto: "modeAutoTitle",
    read: "modeReadTitle",
    memory: "modeMemoryTitle",
    command: "modeCommandTitle",
    workspace: "modeWorkspaceTitle",
  };

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
    setConnectorMode(false);
    setAttachments([]);
    setDraft(stripMessageControlMarkers(message.content));
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const cancelEditing = () => {
    setEditingMessage(null);
    setDraft("");
    setAttachments([]);
    setConnectorMode(false);
  };

  const copyMessage = async (message: Message) => {
    const content = stripMessageControlMarkers(message.content);
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

    const content = buildMessageContent(draft, attachments, agentMode);
    if (!content) return;

    setDraft("");
    setAttachments([]);
    setBranchMode(false);
    setConnectorMode(false);
    if (!selectedNode) {
      if (branchMode) {
        await onStartBranchSplit?.(content);
        return;
      }
      if (connectorMode) {
        await onStartConnector?.(content);
        return;
      }
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
    if (connectorMode) {
      await onProposeConnector(content);
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
            {uiText(language, "selectLeafBranch")}
          </div>
        )}
        {editingMessage && (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-2 text-xs text-[color:var(--muted)]">
            <span className="truncate">{uiText(language, "editingYourMessage")}</span>
            <button
              type="button"
              onClick={cancelEditing}
              className="shrink-0 rounded-full px-2 py-1 text-[color:var(--text)] hover:bg-[color:var(--selected)]"
            >
              {uiText(language, "cancel")}
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
                    aria-label={`${uiText(language, "removeFile")} ${file.name}`}
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
              {attachmentBusy && (
                <div className="inline-flex h-8 shrink-0 items-center rounded-full border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 text-xs text-[color:var(--muted)]">
                  {uiText(language, "loadingFiles")}
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
                      ? uiText(language, "editYourPrompt")
                      : uiText(language, "askAnything")
                    : uiText(language, "parentBranchesReadonly")
                  : uiText(language, "askAnything")
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
                aria-label={attachmentBusy ? uiText(language, "loadingFiles") : uiText(language, "attachFiles")}
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
                onClick={() => {
                  setConnectorMode(false);
                  setBranchMode((value) => !value);
                }}
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border p-0 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  branchMode
                    ? "border-[color:var(--button)] bg-[color:var(--button)] text-[color:var(--button-text)]"
                    : "border-[color:var(--border)] bg-transparent text-[color:var(--text)] hover:bg-[color:var(--selected)]"
                }`}
                aria-label={branchMode ? uiText(language, "cancelBranchSplit") : uiText(language, "branchSplit")}
                aria-pressed={branchMode}
                title={branchMode ? uiText(language, "cancelBranchSplit") : uiText(language, "branchSplit")}
              >
                <BranchSplitIcon />
              </button>
              <button
                type="button"
                disabled={!canToggleConnectorMode || Boolean(editingMessage)}
                onClick={() => {
                  setBranchMode(false);
                  setConnectorMode((value) => !value);
                }}
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border p-0 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  connectorMode
                    ? "border-[color:var(--button)] bg-[color:var(--button)] text-[color:var(--button-text)]"
                    : "border-[color:var(--border)] bg-transparent text-[color:var(--text)] hover:bg-[color:var(--selected)]"
                }`}
                aria-label={connectorMode ? uiText(language, "cancelConnectorDraft") : uiText(language, "connectorDraft")}
                aria-pressed={connectorMode}
                title={connectorMode ? uiText(language, "cancelConnectorDraft") : uiText(language, "connectorDraft")}
              >
                <ConnectorIcon />
              </button>
              <div
                className="hidden h-8 items-center rounded-full border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-0.5 sm:inline-flex"
                aria-label={uiText(language, "agentMode")}
              >
                {AGENT_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={!composerWritable || sending || Boolean(editingMessage)}
                    onClick={() => setAgentMode(mode)}
                    title={uiText(language, modeTitleKey[mode])}
                    className={`h-7 rounded-full px-2 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      agentMode === mode
                        ? "bg-[color:var(--button)] text-[color:var(--button-text)]"
                        : "text-[color:var(--muted)] hover:bg-[color:var(--selected)] hover:text-[color:var(--text)]"
                    }`}
                    aria-pressed={agentMode === mode}
                  >
                    {uiText(language, modeLabelKey[mode])}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="submit"
              disabled={!canSend}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0 bg-[color:var(--button)] p-0 text-[color:var(--button-text)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
              aria-label={uiText(language, "send")}
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
          <HomeHeroTitle language={language} />
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
                ref={(element) => {
                  messageRefs.current[message.id] = element;
                }}
                className={`flex rounded-2xl transition-[background-color,box-shadow] duration-500 ${
                  message.id === targetMessageId
                    ? "bg-[color:var(--selected)] shadow-[0_0_0_1px_var(--border)]"
                    : ""
                } ${message.role === "user" ? "justify-end" : "justify-start"}`}
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
                    onOpenTarget={onOpenTarget}
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
                    <BranchPlanEditor
                      message={message}
                      language={language}
                      busy={sending || branchActionBusy === message.id}
                      onConfirm={async (titles) => {
                        setBranchActionBusy(message.id);
                        try {
                          await onConfirmBranches(message, titles);
                        } finally {
                          setBranchActionBusy("");
                        }
                      }}
                    />
                  )}
                  <MessageActions
                    message={message}
                    canMutate={Boolean(canWrite && message.node_id === selectedNode?.id)}
                    copied={copiedMessageId === message.id}
                    sending={sending}
                    onCopy={() => void copyMessage(message)}
                    onEdit={() => startEditingMessage(message)}
  onRegenerate={() => void onRegenerateMessage(message)}
  onFeedback={(rating) =>
    void api.recordFeedback({
      targetType: "message",
      targetId: message.id,
      target: `chat://tree/${message.tree_id}/node/${message.node_id}/message/${message.id}`,
      rating,
    })
  }
                  />
                </div>
              </div>
            ))}
            {(agentToolEvents.length > 0 || streamingText) && (
              <div className="flex justify-start">
                <div
                  className={`${assistantWidth} min-w-0 break-words text-[15px] leading-7 text-[color:var(--text)]`}
                >
                  {agentToolEvents.length > 0 && (
                    <AgentToolTraceView
                      results={agentToolEvents}
                      permissionProfile={agentToolEvents[0]?.permissionProfile}
                      live
                      onOpenTarget={onOpenTarget}
                    />
                  )}
                  {streamingText && <StreamingMessage content={streamingText} />}
                </div>
              </div>
            )}
            {sending && !streamingText && agentToolEvents.length === 0 && (
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

function HomeHeroTitle({ language }: { language: InterfaceLanguage }) {
  const [institutionIndex, setInstitutionIndex] = useState(0);
  const [characterCount, setCharacterCount] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const institution = HOME_INSTITUTIONS[institutionIndex];
  const typedInstitution = institution.slice(0, characterCount);
  const localizedInstitution = getInstitutionLabel(institution, language);
  const typedLocalizedInstitution =
    characterCount === institution.length ? localizedInstitution : typedInstitution;

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
      aria-label={`ino-agent ${uiText(language, "homeFor")} ${localizedInstitution}`}
    >
      <span>ino-agent {uiText(language, "homeFor")} </span>
      <span className="inline-block min-w-[5ch] text-left">
        <span>{typedLocalizedInstitution}</span>
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-[0.9em] w-[2px] translate-y-[2px] animate-pulse rounded-full bg-[color:var(--text)]"
        />
      </span>
    </div>
  );
}

function BranchPlanEditor({
  message,
  language,
  busy,
  onConfirm,
}: {
  message: Message;
  language: InterfaceLanguage;
  busy: boolean;
  onConfirm: (titles: string[]) => Promise<void>;
}) {
  const initialTitles = branchPlanTitlesFromMessage(message.content);
  const [titles, setTitles] = useState<string[]>(
    initialTitles.length > 0 ? initialTitles : [""],
  );

  useEffect(() => {
    const nextTitles = branchPlanTitlesFromMessage(message.content);
    setTitles(nextTitles.length > 0 ? nextTitles : [""]);
  }, [message.id, message.content]);

  const cleanTitles = () => uniqueNonEmptyTitles(titles);
  const canCreate = cleanTitles().length > 0 && !busy;

  return (
    <div className="mt-4 max-w-[520px] rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] p-3 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <div className="mb-2 text-xs font-medium text-[color:var(--muted)]">
        {uiText(language, "branchTopics")}
      </div>
      <div className="space-y-2">
        {titles.map((title, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="text"
              value={title}
              disabled={busy}
              onChange={(event) => {
                const next = [...titles];
                next[index] = event.target.value;
                setTitles(next);
              }}
              className="h-9 min-w-0 flex-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 text-sm text-[color:var(--text)] outline-none transition-colors placeholder:text-[color:var(--muted)] focus:border-[color:var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={uiText(language, "branchTopicPlaceholder")}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setTitles((current) =>
                  current.length <= 1 ? [""] : current.filter((_, itemIndex) => itemIndex !== index),
                )
              }
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={uiText(language, "removeBranchTopic")}
              title={uiText(language, "removeBranchTopic")}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => setTitles((current) => [...current, ""])}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-[color:var(--border)] bg-transparent px-3 text-sm font-medium text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <PlusIcon />
          <span>{uiText(language, "addBranchTopic")}</span>
        </button>
        <button
          type="button"
          disabled={!canCreate}
          onClick={() => void onConfirm(cleanTitles())}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-[color:var(--button)] bg-[color:var(--button)] px-3 text-sm font-medium text-[color:var(--button-text)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <CheckIcon />
          <span>{uiText(language, "createBranches")}</span>
        </button>
      </div>
    </div>
  );
}

function getInstitutionLabel(
  institution: (typeof HOME_INSTITUTIONS)[number],
  language: InterfaceLanguage,
) {
  const localized: Partial<
    Record<InterfaceLanguage, Partial<Record<(typeof HOME_INSTITUTIONS)[number], string>>>
  > = {
    Russian: {
      MIPT: "МФТИ",
      MSU: "МГУ",
      HSE: "ВШЭ",
      MEPhI: "МИФИ",
      ITMO: "ИТМО",
      NSU: "НГУ",
    },
    Belarusian: {
      MIPT: "МФТІ",
      MSU: "БДУ",
      HSE: "ВШЭ",
      MEPhI: "МІФІ",
      ITMO: "ІТМА",
      NSU: "НДУ",
    },
  };
  return localized[language]?.[institution] ?? institution;
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

function ConnectorIcon() {
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
      <path d="M8 8h8v8H8z" />
      <path d="M4 12h4M16 12h4M12 4v4M12 16v4" />
      <path d="M6 6l2 2M18 6l-2 2M6 18l2-2M18 18l-2-2" />
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

function ThumbUpIcon() {
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
      <path d="M7 10v11H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z" />
      <path d="M7 10 12 2a2.5 2.5 0 0 1 2.4 3.2L13 10h5.5a2.5 2.5 0 0 1 2.4 3.1l-1.4 5.5A3 3 0 0 1 16.6 21H7" />
    </svg>
  );
}

function ThumbDownIcon() {
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
      <path d="M17 14V3h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2z" />
      <path d="m17 14-5 8a2.5 2.5 0 0 1-2.4-3.2L11 14H5.5a2.5 2.5 0 0 1-2.4-3.1l1.4-5.5A3 3 0 0 1 7.4 3H17" />
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
    const directFileData = arrayBufferToBase64(await file.arrayBuffer());
    return {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: "application/pdf",
      content: "",
      directFileData,
      warning: "PDF sent directly to model",
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
  onOpenTarget,
  onSaveQuizAttempt,
}: {
  message: Message;
  quizAttempts: QuizAttempt[];
  onOpenTarget: (target: string) => Promise<void>;
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
  const { visibleText, attachments } = splitAttachmentPayload(stripMessageControlMarkers(content));
  const agentTrace = message.role === "assistant" ? parseAgentTrace(message.visualization_html) : null;
  const hasTrace = agentTrace
    ? agentTrace.toolResults.length > 0 ||
      Boolean(agentTrace.verifier) ||
      hasRetrievalTrace(agentTrace.retrieval)
    : false;
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
      {agentTrace && hasTrace && (
        <AgentToolTraceView
          results={agentTrace.toolResults}
          permissionProfile={agentTrace.permissionProfile}
          verifier={agentTrace.verifier}
          retrieval={agentTrace.retrieval}
          onOpenTarget={onOpenTarget}
        />
      )}
    </>
  );
}

function AgentToolTraceView({
  results,
  permissionProfile,
  verifier,
  retrieval,
  onOpenTarget,
  live = false,
}: {
  results: Array<AgentToolResult | AgentToolEvent>;
  permissionProfile?: string;
  verifier?: AgentTrace["verifier"];
  retrieval?: AgentTrace["retrieval"];
  onOpenTarget: (target: string) => Promise<void>;
  live?: boolean;
}) {
  const profile =
    permissionProfile ||
    results.find((result) => result.permissionProfile)?.permissionProfile ||
    "";
  return (
    <div className={live ? "mb-4" : "mt-4"}>
      <details
        open={live}
        className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] text-[13px] leading-5"
      >
        <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs font-medium text-[color:var(--muted)]">
          <span>Context trace</span>
          {results.length > 0 && <span>tools {results.length}</span>}
          {hasRetrievalTrace(retrieval) && <span>retrieval</span>}
          {profile && (
            <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 font-mono text-[10px] text-[color:var(--text)]">
              {profile}
            </span>
          )}
        </summary>
        <div className="space-y-2 border-t border-[color:var(--border)] p-2">
          {hasRetrievalTrace(retrieval) && (
            <RetrievalTraceView retrieval={retrieval} onOpenTarget={onOpenTarget} />
          )}
          {verifier && (
            <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--app-bg)] p-2">
              <div className="flex items-center justify-between gap-3">
                <div className="font-mono text-xs text-[color:var(--text)]">verifier</div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    verifier.revised
                      ? "bg-amber-500/10 text-amber-700"
                      : "bg-[color:var(--selected)] text-[color:var(--text)]"
                  }`}
                >
                  {verifier.revised ? "revised" : "ok"}
                </span>
              </div>
              {verifier.issues.length > 0 && (
                <div className="mt-1 whitespace-pre-wrap break-words text-xs text-[color:var(--muted)]">
                  {verifier.issues.slice(0, 4).join("\n")}
                </div>
              )}
            </div>
          )}
          {results.map((result, index) => (
            <AgentToolTraceRow
              key={`${result.tool}-${index}`}
              result={result}
              onOpenTarget={onOpenTarget}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

function RetrievalTraceView({
  retrieval,
  onOpenTarget,
}: {
  retrieval: NonNullable<AgentTrace["retrieval"]>;
  onOpenTarget: (target: string) => Promise<void>;
}) {
  const memoryCount = retrieval.memoryResults.length;
  const relatedCount = retrieval.relatedMemory.length;
  const knowledgeCount = retrieval.knowledgeResults.length;
  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--app-bg)] p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-xs text-[color:var(--text)]">retrieval</div>
        <div className="flex flex-wrap gap-1">
          <TracePill label={`memory ${memoryCount}`} />
          <TracePill label={`graph ${relatedCount}`} />
          <TracePill label={`knowledge ${knowledgeCount}`} />
        </div>
      </div>
      {retrieval.query && (
        <div className="mt-1 truncate text-xs text-[color:var(--muted)]">
          query: {retrieval.query}
        </div>
      )}
      <div className="mt-2 space-y-1.5">
        {retrieval.memoryResults.slice(0, 4).map((item) => (
          <RetrievalTraceRow
            key={`memory-${item.id}`}
            title={item.title}
            target={item.target}
            meta={`${item.sourceType} · score ${formatScore(item.score)} · v ${formatScore(item.vectorScore)} · k ${formatScore(item.keywordScore)}`}
            onOpenTarget={onOpenTarget}
          />
        ))}
        {retrieval.relatedMemory.slice(0, 3).map((item) => (
          <RetrievalTraceRow
            key={`related-${item.id}`}
            title={item.title}
            target={item.target}
            meta={`${item.sourceType} · ${item.label} · weight ${formatScore(item.weight)}`}
            onOpenTarget={onOpenTarget}
          />
        ))}
        {retrieval.knowledgeResults.slice(0, 4).map((item) => (
          <RetrievalTraceRow
            key={`knowledge-${item.chunkId}`}
            title={item.title}
            target={item.target}
            meta={`${item.sourceType} · offsets ${item.startOffset}-${item.endOffset} · score ${formatScore(item.score)}`}
            onOpenTarget={onOpenTarget}
          />
        ))}
      </div>
    </div>
  );
}

function RetrievalTraceRow({
  title,
  target,
  meta,
  onOpenTarget,
}: {
  title: string;
  target: string;
  meta: string;
  onOpenTarget: (target: string) => Promise<void>;
}) {
  return (
    <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--panel)] px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-xs font-medium text-[color:var(--text)]">{title}</div>
        <button
          type="button"
          onClick={() => void onOpenTarget(target)}
          className="shrink-0 rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[10px] text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)]"
        >
          Open
        </button>
      </div>
      <div className="mt-0.5 truncate font-mono text-[10px] text-[color:var(--muted)]">{target}</div>
      <div className="mt-0.5 text-[10px] text-[color:var(--muted)]">{meta}</div>
    </div>
  );
}

function TracePill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[10px] text-[color:var(--muted)]">
      {label}
    </span>
  );
}

function AgentToolTraceRow({
  result,
  onOpenTarget,
}: {
  result: AgentToolResult | AgentToolEvent;
  onOpenTarget: (target: string) => Promise<void>;
}) {
  const summary = summarizeToolContent(result.content);
  const targets = extractOpenTargets(result.content);
  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--app-bg)] p-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 truncate font-mono text-xs text-[color:var(--text)]">
          {result.tool}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
            result.ok
              ? "bg-[color:var(--selected)] text-[color:var(--text)]"
              : "bg-red-500/10 text-red-600"
          }`}
        >
          {result.ok ? "ok" : "error"}
        </span>
      </div>
      {summary && (
        <div className="mt-1 whitespace-pre-wrap break-words text-xs text-[color:var(--muted)]">
          {summary}
        </div>
      )}
      {targets.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {targets.slice(0, 5).map((target, index) => (
            <button
              key={`${target}-${index}`}
              type="button"
              onClick={() => void onOpenTarget(target)}
              className="inline-flex h-7 max-w-full items-center rounded-full border border-[color:var(--border)] px-2.5 text-[11px] text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)]"
              title={target}
            >
              <span className="truncate">{targets.length === 1 ? "Open" : `Open ${index + 1}`}</span>
            </button>
          ))}
        </div>
      )}
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-[color:var(--muted)]">
          raw
        </summary>
        <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-[color:var(--panel)] p-2 text-[11px] leading-4 text-[color:var(--text)]">
          {safeJson(result.content)}
        </pre>
      </details>
    </div>
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
  onFeedback,
}: {
  message: Message;
  canMutate: boolean;
  copied: boolean;
  sending: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  onFeedback: (rating: "useful" | "not_useful") => void;
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
      {message.role === "assistant" && (
        <>
          <ActionIconButton
            label="Useful"
            disabled={false}
            onClick={() => onFeedback("useful")}
          >
            <ThumbUpIcon />
          </ActionIconButton>
          <ActionIconButton
            label="Not useful"
            disabled={false}
            onClick={() => onFeedback("not_useful")}
          >
            <ThumbDownIcon />
          </ActionIconButton>
        </>
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

function branchPlanPayloadPattern(flags = "") {
  return new RegExp("```" + BRANCH_PLAN_PAYLOAD_FENCE + "\\n([\\s\\S]*?)\\n```\\s*", flags);
}

function stripBranchPlanPayload(content: string) {
  return content.replace(branchPlanPayloadPattern("g"), "").trim();
}

function branchPlanTitlesFromMessage(content: string) {
  const match = content.match(branchPlanPayloadPattern());
  if (!match?.[1]) return [];
  try {
    const payload = JSON.parse(match[1]) as {
      branches?: Array<{ title?: unknown }>;
    };
    return uniqueNonEmptyTitles(
      (payload.branches ?? [])
        .map((branch) => (typeof branch.title === "string" ? branch.title : ""))
        .filter(Boolean),
    );
  } catch {
    return [];
  }
}

function uniqueNonEmptyTitles(titles: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of titles) {
    const title = value.trim();
    if (!title) continue;
    const key = title.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(title);
  }
  return result;
}

function stripAgentModeMarker(content: string) {
  return content.replace(/<!--\s*ino-agent:mode=(read|memory|command|workspace)\s*-->\s*/g, "").trim();
}

function stripMessageControlMarkers(content: string) {
  return stripAgentModeMarker(stripBranchPlanPayload(stripBranchPlanAction(content)));
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
      /\[Attached file: ([\s\S]*?)\]\n\n(```|~~~~)(?:text|ino-agent-attachment)\n[\s\S]*?\n\2/g,
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

function parseAgentTrace(raw: string | null): AgentTrace | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentTrace>;
    if (!Array.isArray(parsed.toolResults)) return null;
    return {
      permissionProfile:
        typeof parsed.permissionProfile === "string" ? parsed.permissionProfile : undefined,
      verifier: normalizeAgentVerifierTrace(parsed.verifier),
      retrieval: normalizeRetrievalTrace(parsed.retrieval),
      toolResults: parsed.toolResults.filter(
        (item): item is AgentToolResult =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as AgentToolResult).tool === "string" &&
          typeof (item as AgentToolResult).ok === "boolean",
      ),
    };
  } catch {
    return null;
  }
}

function normalizeRetrievalTrace(value: unknown): AgentTrace["retrieval"] {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    query: typeof record.query === "string" ? record.query : "",
    memoryResults: normalizeTraceArray(record.memoryResults, normalizeRetrievalMemory),
    relatedMemory: normalizeTraceArray(record.relatedMemory, normalizeRetrievalRelatedMemory),
    knowledgeResults: normalizeTraceArray(record.knowledgeResults, normalizeRetrievalKnowledge),
  };
}

function normalizeTraceArray<T>(value: unknown, mapper: (value: unknown) => T | null): T[] {
  return Array.isArray(value) ? value.map(mapper).filter((item): item is T => Boolean(item)) : [];
}

function normalizeRetrievalMemory(value: unknown): NonNullable<AgentTrace["retrieval"]>["memoryResults"][number] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = stringField(record.id);
  const title = stringField(record.title);
  const target = stringField(record.target);
  if (!id || !target) return null;
  return {
    id,
    title: title || target,
    target,
    sourceType: stringField(record.sourceType) || "memory",
    score: numberField(record.score),
    vectorScore: numberField(record.vectorScore),
    keywordScore: numberField(record.keywordScore),
  };
}

function normalizeRetrievalRelatedMemory(value: unknown): NonNullable<AgentTrace["retrieval"]>["relatedMemory"][number] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = stringField(record.id);
  const target = stringField(record.target);
  if (!id || !target) return null;
  return {
    id,
    title: stringField(record.title) || target,
    target,
    sourceType: stringField(record.sourceType) || "memory",
    label: stringField(record.label) || "related",
    weight: numberField(record.weight),
  };
}

function normalizeRetrievalKnowledge(value: unknown): NonNullable<AgentTrace["retrieval"]>["knowledgeResults"][number] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const chunkId = stringField(record.chunkId);
  const target = stringField(record.target);
  if (!chunkId || !target) return null;
  return {
    chunkId,
    sourceId: stringField(record.sourceId),
    title: stringField(record.title) || target,
    target,
    sourceType: stringField(record.sourceType) || "knowledge",
    startOffset: numberField(record.startOffset),
    endOffset: numberField(record.endOffset),
    score: numberField(record.score),
    vectorScore: numberField(record.vectorScore),
    keywordScore: numberField(record.keywordScore),
  };
}

function normalizeAgentVerifierTrace(value: unknown): AgentTrace["verifier"] {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    revised: record.revised === true,
    issues: Array.isArray(record.issues)
      ? record.issues.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function hasRetrievalTrace(retrieval: AgentTrace["retrieval"] | undefined): retrieval is NonNullable<AgentTrace["retrieval"]> {
  return Boolean(
    retrieval &&
      (retrieval.memoryResults.length > 0 ||
        retrieval.relatedMemory.length > 0 ||
        retrieval.knowledgeResults.length > 0),
  );
}

function stringField(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberField(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatScore(value: number) {
  return value.toFixed(2);
}

function summarizeToolContent(content: unknown) {
  if (!content || typeof content !== "object") {
    return typeof content === "string" ? content : "";
  }
  const value = content as Record<string, unknown>;
  if (typeof value.error === "string") {
    return value.error;
  }
  if (Array.isArray(value.entries)) {
    return `${value.entries.length} entries`;
  }
  if (typeof value.indexedChunks === "number") {
    return [
      typeof value.path === "string" ? value.path : "",
      `${String(value.indexedFiles ?? 0)} files`,
      `${value.indexedChunks} chunks`,
      typeof value.unchangedFiles === "number" && value.unchangedFiles > 0
        ? `${value.unchangedFiles} unchanged`
        : "",
      Array.isArray(value.skipped) && value.skipped.length > 0
        ? `${value.skipped.length} skipped`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (typeof value.kind === "string" && typeof value.target === "string") {
    return [
      `kind: ${value.kind}`,
      value.target,
      typeof value.path === "string" ? value.path : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value.command === "string") {
    const stdout = typeof value.stdout === "string" ? value.stdout.trim() : "";
    const stderr = typeof value.stderr === "string" ? value.stderr.trim() : "";
    return [
      `$ ${value.command}`,
      `exit: ${String(value.exitCode ?? "null")}`,
      stdout ? `stdout:\n${clipText(stdout, 900)}` : "",
      stderr ? `stderr:\n${clipText(stderr, 900)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value.path === "string") {
    return [
      value.path,
      typeof value.bytes === "number" ? `${value.bytes} bytes` : "",
      value.truncated ? "truncated" : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if ("id" in value && typeof value.title === "string") {
    return `${value.title}${typeof value.target === "string" ? `\n${value.target}` : ""}`;
  }
  return "";
}

function extractOpenTargets(content: unknown) {
  const targets: string[] = [];
  const pushTarget = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      targets.push(value.trim());
    }
  };
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    pushTarget(record.target);
    pushTarget(record.absolutePath);
    pushTarget(record.path);
    if (Array.isArray(record.items)) {
      for (const item of record.items) {
        if (item && typeof item === "object") {
          pushTarget((item as Record<string, unknown>).target);
        }
      }
    }
    if (Array.isArray(record.chunks)) {
      for (const item of record.chunks) {
        if (item && typeof item === "object") {
          pushTarget((item as Record<string, unknown>).target);
        }
      }
    }
    if (Array.isArray(record.memoryResults)) {
      for (const item of record.memoryResults) {
        if (!item || typeof item !== "object") continue;
        const memory = (item as Record<string, unknown>).item;
        if (memory && typeof memory === "object") {
          pushTarget((memory as Record<string, unknown>).target);
        }
      }
    }
    if (Array.isArray(record.knowledgeResults)) {
      for (const item of record.knowledgeResults) {
        if (!item || typeof item !== "object") continue;
        const chunk = (item as Record<string, unknown>).chunk;
        if (chunk && typeof chunk === "object") {
          pushTarget((chunk as Record<string, unknown>).target);
        }
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
    }
  };
  visit(content);
  return Array.from(new Set(targets)).slice(0, 8);
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function clipText(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit).trimEnd()}\n...` : value;
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

function buildMessageContent(draft: string, attachments: AttachmentDraft[], agentMode: AgentMode) {
  const text = draft.trim();
  const modeMarker = agentMode === "auto" ? "" : `<!-- ino-agent:mode=${agentMode} -->`;
  const files = attachments.map((file) => {
    const warning = file.warning ? `\nNote: ${file.warning}` : "";
    if (file.directFileData) {
      return `[Attached file: ${file.name} (${file.type || "unknown"}, ${formatBytes(
        file.size,
      )})${warning}]\n\n\`\`\`ino-agent-attachment\n${JSON.stringify({
        kind: "file",
        filename: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        data: file.directFileData,
      })}\n\`\`\``;
    }
    const fence = file.content.includes("```") ? "~~~~" : "```";
    return `[Attached file: ${file.name} (${file.type || "unknown"}, ${formatBytes(
      file.size,
    )})${warning}]\n\n${fence}text\n${file.content}\n${fence}`;
  });
  return [modeMarker, text, ...files].filter(Boolean).join("\n\n").trim();
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
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
