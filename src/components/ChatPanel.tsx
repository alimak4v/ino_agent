import {
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { api, isTauriRuntime, type ChatSettings, type Message, type SettingsInput } from "../lib/api";
import type { CanvasLayoutNode } from "./TreeCanvas";
import { MarkdownMessage } from "./MarkdownMessage";

interface ChatPanelProps {
  selectedNode: CanvasLayoutNode | null;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  streamingText: string;
  visualizationErrors: Record<string, string>;
  canWrite: boolean;
  fullWidth: boolean;
  error: string;
  settings: ChatSettings;
  treeVisible: boolean;
  panelWidth?: number;
  onToggleTree: () => void;
  onSend: (content: string) => Promise<void>;
  onSaveSettings: (input: SettingsInput) => Promise<void>;
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

export function ChatPanel({
  selectedNode,
  messages,
  loading,
  sending,
  streamingText,
  visualizationErrors,
  canWrite,
  fullWidth,
  error,
  settings,
  treeVisible,
  panelWidth,
  onToggleTree,
  onSend,
  onSaveSettings,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<ChatSettings>(settings);
  const [savingSettings, setSavingSettings] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSettingsDraft(settings);
  }, [settings]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, sending, loading, streamingText]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(156, Math.max(28, textarea.scrollHeight))}px`;
  }, [draft]);

  const canSend = Boolean(
    selectedNode && canWrite && !sending && (draft.trim() || attachments.length > 0),
  );

  const attachFiles = async (files: FileList | null) => {
    if (!files?.length || !canWrite || sending) return;
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

  const submitMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!selectedNode || !canWrite || sending) return;

    const content = buildMessageContent(draft, attachments);
    if (!content) return;

    setDraft("");
    setAttachments([]);
    await onSend(content);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    setSavingSettings(true);
    try {
      await onSaveSettings(settingsDraft);
      setSettingsOpen(false);
    } finally {
      setSavingSettings(false);
    }
  };

  const contentShell = fullWidth
    ? "mx-auto w-full max-w-[920px] min-w-0"
    : "w-full min-w-0";
  const composerShell = fullWidth
    ? "mx-auto w-full max-w-[820px] min-w-0"
    : "w-full min-w-0";
  const assistantWidth = "max-w-[100%]";
  const userWidth = "max-w-[92%]";
  const panelStyle = fullWidth || !panelWidth ? undefined : { width: `${panelWidth}px` };

  return (
    <aside
      style={panelStyle}
      className={`no-drag flex h-full min-w-0 shrink-0 flex-col overflow-hidden bg-[color:var(--app-bg)] text-[color:var(--text)] ${
        fullWidth
          ? "w-full border-l-0"
          : "border-l border-[color:var(--border)]"
      }`}
    >
      <header className="border-b border-[color:var(--border)] bg-[color:var(--app-bg)]/95 px-5 py-3 shadow-[0_1px_0_rgba(255,255,255,0.02)]">
        <div
          className={`${contentShell} flex min-h-10 items-center justify-between gap-3 ${
            fullWidth ? "pl-24" : ""
          }`}
        >
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold tracking-normal">
              {selectedNode?.title ?? "No node selected"}
            </div>
            <div className="truncate text-xs text-[color:var(--muted)]">
              {selectedNode
                ? selectedNode.is_leaf
                  ? selectedNode.treeTitle
                  : `${selectedNode.treeTitle} · branch point`
                : "Chat"}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onToggleTree}
              className="rounded-full border border-transparent px-2.5 py-1.5 text-xs font-medium text-[color:var(--muted)] transition-colors hover:border-[color:var(--border)] hover:bg-[color:var(--panel)] hover:text-[color:var(--text)]"
            >
              {treeVisible ? "Focus" : "Tree"}
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen((value) => !value)}
              className="rounded-full border border-transparent px-2.5 py-1.5 text-xs font-medium text-[color:var(--muted)] transition-colors hover:border-[color:var(--border)] hover:bg-[color:var(--panel)] hover:text-[color:var(--text)]"
            >
              API
            </button>
          </div>
        </div>

        {settingsOpen && (
          <form
            onSubmit={saveSettings}
            className={`${contentShell} ${fullWidth ? "pl-24" : ""} mt-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] p-3`}
          >
            <div className="grid gap-2 md:grid-cols-[1fr_180px]">
              <label className="block text-xs text-[color:var(--muted)]">
                API key
                <input
                  type="password"
                  value={settingsDraft.api_key}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      api_key: event.target.value,
                    }))
                  }
                  className="mt-1 h-9 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 text-sm text-[color:var(--text)] outline-none focus:border-[color:var(--accent)]"
                  placeholder="sk-..."
                />
              </label>
              <label className="block text-xs text-[color:var(--muted)]">
                Model
                <input
                  type="text"
                  value={settingsDraft.model}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      model: event.target.value,
                    }))
                  }
                  className="mt-1 h-9 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 text-sm text-[color:var(--text)] outline-none focus:border-[color:var(--accent)]"
                />
              </label>
            </div>
            <label className="mt-2 block text-xs text-[color:var(--muted)]">
              Endpoint
              <input
                type="text"
                value={settingsDraft.endpoint}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    endpoint: event.target.value,
                  }))
                }
                className="mt-1 h-9 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 text-sm text-[color:var(--text)] outline-none focus:border-[color:var(--accent)]"
              />
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setSettingsDraft(settings);
                  setSettingsOpen(false);
                }}
                className="rounded-full px-3 py-1.5 text-xs text-[color:var(--muted)] hover:bg-[color:var(--selected)] hover:text-[color:var(--text)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingSettings}
                className="rounded-full bg-[color:var(--button)] px-3 py-1.5 text-xs font-medium text-[color:var(--button-text)] disabled:opacity-60"
              >
                {savingSettings ? "Saving" : "Save"}
              </button>
            </div>
          </form>
        )}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-7">
        {loading ? (
          <div className={`${contentShell} text-sm text-[color:var(--muted)]`}>Loading</div>
        ) : messages.length === 0 && !streamingText ? (
          <div
            className={`${contentShell} flex min-h-full items-center justify-center text-center text-sm text-[color:var(--muted)]`}
          >
            {selectedNode ? "Empty node" : "No node selected"}
          </div>
        ) : (
          <div className={`${contentShell} space-y-7`}>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={
                    message.role === "user"
                      ? `${userWidth} min-w-0 break-words rounded-3xl bg-[color:var(--panel)] px-4 py-3 text-[15px] leading-7 text-[color:var(--text)] shadow-sm`
                      : `${assistantWidth} min-w-0 break-words text-[15px] leading-7 text-[color:var(--text)]`
                  }
                >
                  <MessageContent content={message.content} />
                  {message.visualization_html && (
                    <InlineVisualization html={message.visualization_html} />
                  )}
                  {visualizationErrors[message.id] && (
                    <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-200">
                      {visualizationErrors[message.id]}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {streamingText && (
              <div className="flex justify-start">
                <div
                  className={`${assistantWidth} min-w-0 break-words text-[15px] leading-7 text-[color:var(--text)]`}
                >
                  <MessageContent content={streamingText} />
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

      {(error || attachmentError) && (
        <div className="px-5 pb-2 text-xs text-red-300">
          <div className={`${composerShell} space-y-1 whitespace-pre-wrap break-words`}>
            {error && <div>{error}</div>}
            {attachmentError && <div>{attachmentError}</div>}
          </div>
        </div>
      )}

      <form
        onSubmit={submitMessage}
        onDrop={handleDrop}
        onDragOver={(event) => {
          if (!canWrite || sending) return;
          event.preventDefault();
          setDropActive(true);
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget as Node | null;
          if (nextTarget && event.currentTarget.contains(nextTarget)) return;
          setDropActive(false);
        }}
        className="bg-gradient-to-t from-[color:var(--app-bg)] via-[color:var(--app-bg)] px-5 pb-5 pt-2"
      >
        <div className={composerShell}>
          {!canWrite && selectedNode && (
            <div className="mb-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-2 text-xs text-[color:var(--muted)]">
              Select or create a leaf branch to write.
            </div>
          )}

          <div
            className={`overflow-hidden rounded-[28px] border shadow-[0_18px_44px_rgba(0,0,0,0.22)] transition-colors focus-within:border-[color:var(--accent)] ${
              dropActive
                ? "border-[color:var(--accent)] bg-[color:var(--selected)]"
                : "border-[color:var(--border)] bg-[#1D1D20]"
            }`}
          >
            {(attachments.length > 0 || attachmentBusy) && (
              <div className="flex max-h-24 gap-2 overflow-x-auto border-b border-[color:var(--border)] px-3 py-2">
                {attachments.map((file) => (
                  <div
                    key={file.id}
                    className="flex max-w-[220px] shrink-0 items-center gap-2 rounded-2xl bg-[color:var(--panel-soft)] px-3 py-2 text-xs text-[color:var(--text)]"
                    title={file.warning || file.name}
                  >
                    <div className="min-w-0">
                      <div className="truncate leading-4">{file.name}</div>
                      <div className="truncate text-[11px] leading-4 text-[color:var(--muted)]">
                        {file.warning ?? formatBytes(file.size)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(file.id)}
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[color:var(--muted)] hover:bg-[color:var(--selected)] hover:text-[color:var(--text)]"
                      aria-label={`Remove ${file.name}`}
                    >
                      x
                    </button>
                  </div>
                ))}
                {attachmentBusy && (
                  <div className="shrink-0 rounded-2xl bg-[color:var(--panel-soft)] px-3 py-2 text-xs text-[color:var(--muted)]">
                    Loading files
                  </div>
                )}
              </div>
            )}
            <div className="flex items-end gap-2 px-2 py-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => void attachFiles(event.target.files)}
            />
            <button
              type="button"
              disabled={!canWrite || sending || attachmentBusy}
              onClick={() => fileInputRef.current?.click()}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xl leading-none text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={attachmentBusy ? "Loading files" : "Attach files"}
            >
              {attachmentBusy ? "..." : "+"}
            </button>
            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              disabled={!selectedNode || !canWrite || sending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              className="max-h-[156px] min-h-[28px] flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] leading-7 text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={
                selectedNode
                  ? canWrite
                    ? "Спроси что-нибудь"
                    : "Parent branches are read-only"
                  : "No node selected"
              }
            />
            <button
              type="submit"
              disabled={!canSend}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[color:var(--button)] text-base font-semibold text-[color:var(--button-text)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Send"
            >
              ↑
            </button>
            </div>
          </div>
        </div>
      </form>
    </aside>
  );
}

function InlineVisualization({ html }: { html: string }) {
  const [expanded, setExpanded] = useState(false);
  const renderFrame = (title: string) => (
    <iframe
      title={title}
      sandbox="allow-scripts"
      srcDoc={html}
      className="h-full w-full border-0"
    />
  );

  return (
    <>
      <div className="mt-5 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[#121212] shadow-[0_18px_44px_rgba(0,0,0,0.22)]">
        <div className="flex h-9 items-center justify-end border-b border-[color:var(--border)] bg-[#17181C] px-2">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded-md border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 text-xs font-medium text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)]"
          >
            Fullscreen
          </button>
        </div>
        <div className="h-[min(520px,60vh)] min-h-[360px]">
          {renderFrame("Interactive visualization")}
        </div>
      </div>
      {expanded && (
        <div className="no-drag fixed inset-0 z-[120] flex flex-col bg-[#121212]">
          <div className="flex h-12 shrink-0 items-center justify-end border-b border-white/10 bg-[#17181C] px-3">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black transition-opacity hover:opacity-85"
            >
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {renderFrame("Fullscreen interactive visualization")}
          </div>
        </div>
      )}
    </>
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
    const clipped = text.length > MAX_TEXT_CHARS
      ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[File clipped]`
      : text;
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

function MessageContent({ content }: { content: string }) {
  const { visibleText, attachments } = splitAttachmentPayload(content);
  return (
    <>
      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              key={`${attachment.name}-${attachment.index}`}
              className="max-w-full rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-xs leading-5 text-[color:var(--text)]"
            >
              <div className="max-w-[260px] truncate font-medium">{attachment.name}</div>
              <div className="text-[color:var(--muted)]">{attachment.meta}</div>
            </div>
          ))}
        </div>
      )}
      {visibleText && <MarkdownMessage content={visibleText} />}
    </>
  );
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
