import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  api,
  isTauriRuntime,
  type AssistantDelta,
  type ChatSettings,
  type Message,
  type SettingsInput,
  type TreeSummary,
} from "./lib/api";
import { applyThemeVars, THEMES } from "./lib/theme";
import { AppDialog, type AppDialogState } from "./components/AppDialog";
import { ChatPanel } from "./components/ChatPanel";
import { TreeCanvas, type CanvasLayoutNode } from "./components/TreeCanvas";

const DEFAULT_SETTINGS: ChatSettings = {
  endpoint: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4.1-mini",
  api_key: "",
};
const MIN_TREE_WIDTH = 240;
const MIN_CHAT_WIDTH = 340;
const MAX_CHAT_WIDTH = 620;
const DIVIDER_WIDTH = 8;

export default function App() {
  const [trees, setTrees] = useState<TreeSummary[]>([]);
  const [nodes, setNodes] = useState<CanvasLayoutNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [activeRequests, setActiveRequests] = useState<Record<string, string>>({});
  const [streamingText, setStreamingText] = useState<Record<string, string>>({});
  const [chatError, setChatError] = useState("");
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState("");
  const [treeVisible, setTreeVisible] = useState(true);
  const [chatWidth, setChatWidth] = useState(500);
  const [dividerDragging, setDividerDragging] = useState(false);
  const [dialog, setDialog] = useState<AppDialogState | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);
  const activeRequestsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    applyThemeVars(THEMES["Obsidian Dark"]);
  }, []);

  useEffect(() => {
    void api
      .getSettings()
      .then(setSettings)
      .catch((e) => setChatError(String(e)));
  }, []);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    activeRequestsRef.current = activeRequests;
  }, [activeRequests]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const selectedTreeId = selectedNode?.treeId ?? null;
  const selectedCanvasNodeId = selectedNode?.id ?? null;
  const selectedNodeIsSending = Boolean(
    selectedCanvasNodeId && activeRequests[selectedCanvasNodeId],
  );
  const selectedStreamingText = selectedCanvasNodeId
    ? streamingText[selectedCanvasNodeId] ?? ""
    : "";

  const askText = useCallback(
    (options: {
      title: string;
      label: string;
      value?: string;
      placeholder?: string;
      confirmText?: string;
    }) =>
      new Promise<string | null>((resolve) => {
        setDialog({
          type: "text",
          title: options.title,
          label: options.label,
          value: options.value ?? "",
          placeholder: options.placeholder,
          confirmText: options.confirmText ?? "Save",
          resolve,
        });
      }),
    [],
  );

  const askConfirm = useCallback(
    (options: {
      title: string;
      message: string;
      confirmText?: string;
      destructive?: boolean;
    }) =>
      new Promise<boolean>((resolve) => {
        setDialog({
          type: "confirm",
          title: options.title,
          message: options.message,
          confirmText: options.confirmText ?? "OK",
          destructive: options.destructive,
          resolve,
        });
      }),
    [],
  );

  const clampChatWidth = useCallback((width: number) => {
    const viewportWidth =
      typeof window === "undefined"
        ? MIN_TREE_WIDTH + DIVIDER_WIDTH + MAX_CHAT_WIDTH
        : window.innerWidth;
    const maxByViewport = Math.max(
      MIN_CHAT_WIDTH,
      viewportWidth - MIN_TREE_WIDTH - DIVIDER_WIDTH,
    );
    const maxWidth = Math.min(MAX_CHAT_WIDTH, maxByViewport);
    return Math.min(maxWidth, Math.max(MIN_CHAT_WIDTH, Math.round(width)));
  }, []);

  useEffect(() => {
    const onResize = () => setChatWidth((width) => clampChatWidth(width));
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [clampChatWidth]);

  const beginDividerDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDividerDragging(true);
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const updateWidth = (clientX: number) => {
        setChatWidth(clampChatWidth(window.innerWidth - clientX));
      };
      updateWidth(event.clientX);

      const onPointerMove = (moveEvent: PointerEvent) => {
        updateWidth(moveEvent.clientX);
      };
      const onPointerUp = () => {
        setDividerDragging(false);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp, { once: true });
    },
    [clampChatWidth],
  );

  const selectLocally = useCallback((nodeId: string | null) => {
    selectedNodeIdRef.current = nodeId;
    setSelectedNodeId(nodeId);
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        selected: node.id === nodeId,
      })),
    );
  }, []);

  const loadMessages = useCallback(async (treeId: string, nodeId: string) => {
    setMessagesLoading(true);
    try {
      const nextMessages = await api.getMessages(treeId, nodeId);
      setMessages(nextMessages);
      setChatError("");
    } catch (e) {
      setMessages([]);
      setChatError(String(e));
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const loadCanvas = useCallback(async (preferredNodeId?: string | null) => {
    setLoading(true);
    try {
      const list = await api.listTrees();
      const layouts = await Promise.all(
        list.map(async (tree) => ({
          tree,
          layout: await api.getTreeLayout(tree.id),
        })),
      );

      let nextX = 0;
      const combined: CanvasLayoutNode[] = [];
      for (const { tree, layout } of layouts) {
        if (layout.length === 0) continue;
        const minX = Math.min(...layout.map((node) => node.x));
        const maxX = Math.max(...layout.map((node) => node.x));
        const treeWidth = Math.max(420, maxX - minX + 340);

        combined.push(
          ...layout.map((node) => ({
            ...node,
            treeId: tree.id,
            treeTitle: tree.title,
            isRoot: !node.parent_id,
            x: node.x - minX + nextX,
            y: node.y + 110,
            selected: false,
          })),
        );
        nextX += treeWidth;
      }

      const requestedSelection = preferredNodeId ?? selectedNodeIdRef.current;
      const nextSelected =
        combined.find((node) => node.id === requestedSelection)?.id ??
        combined.find((node) => node.isRoot)?.id ??
        null;

      selectedNodeIdRef.current = nextSelected;
      setSelectedNodeId(nextSelected);
      setTrees(list);
      setNodes(
        combined.map((node) => ({
          ...node,
          selected: node.id === nextSelected,
        })),
      );
      setStatusText("");
    } catch (e) {
      setStatusText(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCanvas(null);
  }, [loadCanvas]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    void listen<AssistantDelta>("assistant-delta", (event) => {
      const payload = event.payload;
      const activeRequest = activeRequestsRef.current[payload.node_id];
      if (!activeRequest || activeRequest !== payload.request_id) {
        return;
      }
      setStreamingText((current) => ({
        ...current,
        [payload.node_id]: `${current[payload.node_id] ?? ""}${payload.delta}`,
      }));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!selectedTreeId || !selectedCanvasNodeId) {
      setMessages([]);
      setMessagesLoading(false);
      return;
    }

    void loadMessages(selectedTreeId, selectedCanvasNodeId);
  }, [loadMessages, selectedCanvasNodeId, selectedTreeId]);

  const handleCreateRoot = useCallback(async () => {
    const title = await askText({
      title: "New root",
      label: "Root name",
      placeholder: "Root",
      confirmText: "Create",
    });
    if (title === null) return;
    const nextTitle = title.trim() || "Root";

    try {
      const created = await api.createTree(nextTitle);
      await api.setCurrentNode(created.tree_id, created.root_node_id);
      await loadCanvas(created.root_node_id);
    } catch (e) {
      setStatusText(String(e));
    }
  }, [askText, loadCanvas]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    void listen("tray-new-tree", () => {
      void handleCreateRoot();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [handleCreateRoot]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void handleCreateRoot();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleCreateRoot]);

  const handleSelectNode = useCallback(
    async (treeId: string, nodeId: string) => {
      selectLocally(nodeId);
      try {
        await api.setCurrentNode(treeId, nodeId);
      } catch (e) {
        setStatusText(String(e));
      }
    },
    [selectLocally],
  );

  const handleRenameNode = useCallback(
    async (node: CanvasLayoutNode) => {
      const title = await askText({
        title: "Rename branch",
        label: "Branch name",
        value: node.title,
        confirmText: "Rename",
      });
      if (title === null) return;
      const nextTitle = title.trim();
      if (!nextTitle) return;

      try {
        await api.renameNode(node.treeId, node.id, nextTitle);
        await api.setCurrentNode(node.treeId, node.id);
        await loadCanvas(node.id);
      } catch (e) {
        setStatusText(String(e));
      }
    },
    [askText, loadCanvas],
  );

  const handleCreateChild = useCallback(
    async (node: CanvasLayoutNode) => {
      const title = await askText({
        title: "New branch",
        label: `Child of "${node.title}"`,
        placeholder: "New node",
        confirmText: "Create",
      });
      if (title === null) return;
      const nextTitle = title.trim() || "New node";

      try {
        const childId = await api.createChildNode(node.treeId, node.id, nextTitle);
        await api.setCurrentNode(node.treeId, childId);
        await loadCanvas(childId);
      } catch (e) {
        setStatusText(String(e));
      }
    },
    [askText, loadCanvas],
  );

  const handleDeleteNode = useCallback(
    async (node: CanvasLayoutNode) => {
      const message = node.isRoot
        ? `Delete root "${node.title}" and all of its children?`
        : `Delete "${node.title}" and its children?`;
      const confirmed = await askConfirm({
        title: node.isRoot ? "Delete root" : "Delete branch",
        message,
        confirmText: "Delete",
        destructive: true,
      });
      if (!confirmed) return;

      try {
        if (node.isRoot) {
          await api.deleteTree(node.treeId);
          await loadCanvas(null);
          return;
        }

        const result = await api.deleteNode(node.treeId, node.id);
        if (result.parent_id) {
          await api.setCurrentNode(node.treeId, result.parent_id);
        }
        await loadCanvas(result.parent_id);
      } catch (e) {
        setStatusText(String(e));
      }
    },
    [askConfirm, loadCanvas],
  );

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!selectedNode || !selectedNode.is_leaf) return;

      const treeId = selectedNode.treeId;
      const nodeId = selectedNode.id;
      if (activeRequestsRef.current[nodeId]) return;

      const requestId = crypto.randomUUID();
      setActiveRequests((current) => ({ ...current, [nodeId]: requestId }));
      setStreamingText((current) => ({ ...current, [nodeId]: "" }));
      setChatError("");

      try {
        const userMessage = await api.addUserMessage(treeId, nodeId, content);
        if (selectedNodeIdRef.current === nodeId) {
          setMessages((current) => [...current, userMessage]);
        }
        await loadCanvas(nodeId);

        const reply = await api.generateAssistantReply(treeId, nodeId, requestId);
        const nextNodeId = reply.selected_node_id || nodeId;
        const createdCount = reply.created_branches.length;
        const currentSelection = selectedNodeIdRef.current;
        const shouldAdoptReplySelection =
          currentSelection === nodeId || currentSelection === nextNodeId;

        if (shouldAdoptReplySelection) {
          await loadMessages(treeId, nextNodeId);
        }
        await loadCanvas(shouldAdoptReplySelection ? nextNodeId : currentSelection);
        if (createdCount > 0) {
          setStatusText(
            createdCount === 1
              ? "Created 1 branch"
              : `Created ${createdCount} branches`,
          );
        }
      } catch (e) {
        setChatError(String(e));
        if (selectedNodeIdRef.current === nodeId) {
          await loadMessages(treeId, nodeId);
        }
      } finally {
        setActiveRequests((current) => {
          const next = { ...current };
          delete next[nodeId];
          return next;
        });
        setStreamingText((current) => {
          const next = { ...current };
          delete next[nodeId];
          return next;
        });
      }
    },
    [loadCanvas, loadMessages, selectedNode],
  );

  const handleSaveSettings = useCallback(async (input: SettingsInput) => {
    try {
      const saved = await api.saveSettings(input);
      setSettings(saved);
      setChatError("");
    } catch (e) {
      setChatError(String(e));
      throw e;
    }
  }, []);

  return (
    <main className="no-drag relative flex h-screen overflow-hidden bg-[color:var(--app-bg)] text-[color:var(--text)]">
      <div className="drag-region absolute left-0 right-0 top-0 z-20 h-2" />
      {treeVisible && (
        <section className="min-w-0 flex-1 overflow-hidden">
          <TreeCanvas
            nodes={nodes}
            rootsCount={trees.length}
            loading={loading}
            statusText={statusText}
            onCreateRoot={handleCreateRoot}
            onSelectNode={handleSelectNode}
            onRenameNode={handleRenameNode}
            onCreateChild={handleCreateChild}
            onDeleteNode={handleDeleteNode}
          />
        </section>
      )}
      {treeVisible && (
        <div
          role="separator"
          aria-label="Resize tree and chat panels"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={beginDividerDrag}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setChatWidth((width) => clampChatWidth(width + 24));
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              setChatWidth((width) => clampChatWidth(width - 24));
            }
          }}
          className={`no-drag group relative z-30 w-2 shrink-0 cursor-col-resize outline-none ${
            dividerDragging ? "bg-[color:var(--selected)]" : "bg-transparent"
          }`}
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[color:var(--border)] transition-colors group-hover:bg-[color:var(--accent)] group-focus-visible:bg-[color:var(--accent)]" />
        </div>
      )}
      <ChatPanel
        selectedNode={selectedNode}
        messages={messages}
        loading={messagesLoading}
        sending={selectedNodeIsSending}
        streamingText={selectedStreamingText}
        canWrite={Boolean(selectedNode?.is_leaf)}
        fullWidth={!treeVisible}
        error={chatError}
        settings={settings}
        treeVisible={treeVisible}
        panelWidth={treeVisible ? chatWidth : undefined}
        onToggleTree={() => setTreeVisible((value) => !value)}
        onSend={handleSendMessage}
        onSaveSettings={handleSaveSettings}
      />
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
    </main>
  );
}
