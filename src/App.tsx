import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openShell } from "@tauri-apps/plugin-shell";
import {
  api,
  isTauriRuntime,
  type AgentToolEvent,
  type AssistantDelta,
  type AssistantReplyResult,
  type ChatSettings,
  type ConnectorSummary,
  type Message,
  type SettingsInput,
  type TreeCreated,
  type TreeSummary,
} from "./lib/api";
import { applyThemeVars, THEMES, type ThemeName } from "./lib/theme";
import { AgentTasksPanel } from "./components/AgentTasksPanel";
import { AppDialog, type AppDialogState } from "./components/AppDialog";
import { KnowledgePanel } from "./components/KnowledgePanel";
import { MemoryPanel } from "./components/MemoryPanel";
import { ProjectWizardPanel } from "./components/ProjectWizardPanel";
import { SearchPanel } from "./components/SearchPanel";
import { TerminalPanel } from "./components/TerminalPanel";
import type { CanvasLayoutNode } from "./components/TreeCanvas";

const ChatPanel = lazy(() =>
  import("./components/ChatPanel").then((module) => ({ default: module.ChatPanel })),
);
const TreeCanvas = lazy(() =>
  import("./components/TreeCanvas").then((module) => ({ default: module.TreeCanvas })),
);
const RenderSmoke = lazy(() =>
  import("./components/RenderSmoke").then((module) => ({ default: module.RenderSmoke })),
);

const DEFAULT_SETTINGS: ChatSettings = {
  endpoint: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4.1-mini",
  api_key: "",
  theme: "Minimal Light",
};
const THEME_NAMES = Object.keys(THEMES) as ThemeName[];
const COMPACT_LAYOUT_WIDTH = 860;
const MIN_TREE_WIDTH = 360;
const MIN_CHAT_WIDTH = 420;
const TARGET_CHAT_WIDTH = 760;
const DIVIDER_WIDTH = 8;
const ONBOARDING_STORAGE_KEY = "ino-agent:onboarding:v1";

interface KnowledgeWatchEvent {
  ok: boolean;
  content: unknown;
}

function getViewportWidth() {
  return typeof window === "undefined" ? 1440 : window.innerWidth;
}

function getMinChatWidth(viewportWidth: number) {
  const available = viewportWidth - MIN_TREE_WIDTH - DIVIDER_WIDTH;
  return Math.min(TARGET_CHAT_WIDTH, Math.max(MIN_CHAT_WIDTH, available));
}

export default function App() {
  if (typeof window !== "undefined" && window.location.search.includes("renderSmoke=1")) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-[color:var(--app-bg)] p-6 text-sm text-[color:var(--muted)]">
            Loading render fixture
          </div>
        }
      >
        <RenderSmoke />
      </Suspense>
    );
  }

  const [trees, setTrees] = useState<TreeSummary[]>([]);
  const [activeTreeId, setActiveTreeId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<CanvasLayoutNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [targetMessageId, setTargetMessageId] = useState("");
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [activeRequests, setActiveRequests] = useState<Record<string, string>>({});
  const [streamingText, setStreamingText] = useState<Record<string, string>>({});
  const [agentToolEvents, setAgentToolEvents] = useState<Record<string, AgentToolEvent[]>>({});
  const [chatError, setChatError] = useState("");
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState("");
  const [treeVisible, setTreeVisible] = useState(false);
  const [chatHomeVisible, setChatHomeVisible] = useState(true);
  const [startingChat, setStartingChat] = useState(false);
  const [windowFullscreen, setWindowFullscreen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(getViewportWidth);
  const [chatWidth, setChatWidth] = useState(() => {
    const viewportWidth = getViewportWidth();
    return Math.min(
      Math.round(viewportWidth * 0.48),
      viewportWidth - MIN_TREE_WIDTH - DIVIDER_WIDTH,
    );
  });
  const [dividerDragging, setDividerDragging] = useState(false);
  const [dialog, setDialog] = useState<AppDialogState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<ChatSettings>(DEFAULT_SETTINGS);
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const selectedNodeIdRef = useRef<string | null>(null);
  const activeTreeIdRef = useRef<string | null>(null);
  const activeRequestsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    applyThemeVars(THEMES[settings.theme] ?? THEMES[DEFAULT_SETTINGS.theme]);
  }, [settings.theme]);

  useEffect(() => {
    try {
      setOnboardingOpen(window.localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "done");
    } catch {
      setOnboardingOpen(false);
    }
  }, []);

  const dismissOnboarding = useCallback(() => {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "done");
    } catch {
      // localStorage can be unavailable in hardened or private contexts.
    }
    setOnboardingOpen(false);
  }, []);

  useEffect(() => {
    void api
      .getSettings()
      .then((loaded) => {
        setSettings(loaded);
        setSettingsDraft(loaded);
      })
      .catch((e) => setChatError(String(e)));
  }, []);

  const loadConnectors = useCallback(async () => {
    setConnectorsLoading(true);
    try {
      setConnectors(await api.listConnectors());
    } catch (e) {
      setStatusText(String(e));
    } finally {
      setConnectorsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void loadConnectors();
  }, [loadConnectors]);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    activeTreeIdRef.current = activeTreeId;
  }, [activeTreeId]);

  useEffect(() => {
    activeRequestsRef.current = activeRequests;
  }, [activeRequests]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const activeTree = useMemo(
    () => trees.find((tree) => tree.id === activeTreeId) ?? null,
    [activeTreeId, trees],
  );

  const selectedTreeId = selectedNode?.treeId ?? null;
  const selectedCanvasNodeId = selectedNode?.id ?? null;
  const selectedNodeIsSending = Boolean(
    selectedCanvasNodeId && activeRequests[selectedCanvasNodeId],
  );
  const selectedStreamingText = selectedCanvasNodeId
    ? streamingText[selectedCanvasNodeId] ?? ""
    : "";
  const selectedAgentToolEvents = selectedCanvasNodeId
    ? agentToolEvents[selectedCanvasNodeId] ?? []
    : [];
  const compactLayout = viewportWidth < COMPACT_LAYOUT_WIDTH;
  const titlebarNeedsTrafficSpace = isTauriRuntime() && !windowFullscreen;
  const titlebarTitle = chatHomeVisible ? "ino-agent" : selectedNode?.title ?? activeTree?.title ?? "ino-agent";
  const titlebarSubtitle =
    !chatHomeVisible && selectedNode && selectedNode.treeTitle !== selectedNode.title
      ? selectedNode.treeTitle
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
    const viewportWidth = getViewportWidth();
    const minByViewport = getMinChatWidth(viewportWidth);
    const maxByViewport = Math.max(
      minByViewport,
      viewportWidth - MIN_TREE_WIDTH - DIVIDER_WIDTH,
    );
    return Math.min(maxByViewport, Math.max(minByViewport, Math.round(width)));
  }, []);

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(getViewportWidth());
      setChatWidth((width) => clampChatWidth(width));
    };
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [clampChatWidth]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlistenResize: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;

    const refreshFullscreenState = () => {
      void appWindow
        .isFullscreen()
        .then((isFullscreen) => {
          if (!disposed) {
            setWindowFullscreen(isFullscreen);
          }
        })
        .catch(() => {
          if (!disposed) {
            setWindowFullscreen(false);
          }
        });
    };

    refreshFullscreenState();
    void appWindow.onResized(refreshFullscreenState).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlistenResize = fn;
    });
    void appWindow.onFocusChanged(refreshFullscreenState).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlistenFocus = fn;
    });

    return () => {
      disposed = true;
      unlistenResize?.();
      unlistenFocus?.();
    };
  }, []);

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
    const isStillSelected = () => selectedNodeIdRef.current === nodeId;
    try {
      const nextMessages = await api.getMessages(treeId, nodeId);
      if (isStillSelected()) {
        setMessages(nextMessages);
        setChatError("");
      }
    } catch (e) {
      if (isStillSelected()) {
        setMessages([]);
        setChatError(String(e));
      }
    } finally {
      if (isStillSelected()) {
        setMessagesLoading(false);
      }
    }
  }, []);

  const loadCanvas = useCallback(async (preferredNodeId?: string | null, preferredTreeId?: string | null) => {
    setLoading(true);
    try {
      const list = await api.listTrees();
      const requestedTreeId = preferredTreeId ?? activeTreeIdRef.current;
      const nextTree =
        list.find((tree) => tree.id === requestedTreeId) ??
        list[0] ??
        null;
      const layout = nextTree ? await api.getTreeLayout(nextTree.id) : [];
      const canvasNodes = nextTree
        ? layout.map((node) => ({
            ...node,
            treeId: nextTree.id,
            treeTitle: nextTree.title,
            isRoot: !node.parent_id,
            selected: false,
          }))
        : [];

      const requestedSelection = preferredNodeId ?? selectedNodeIdRef.current;
      const nextSelected =
        canvasNodes.find((node) => node.id === requestedSelection)?.id ??
        canvasNodes.find((node) => node.id === nextTree?.last_node_id)?.id ??
        canvasNodes.find((node) => node.isRoot)?.id ??
        null;

      selectedNodeIdRef.current = nextSelected;
      activeTreeIdRef.current = nextTree?.id ?? null;
      setSelectedNodeId(nextSelected);
      setActiveTreeId(nextTree?.id ?? null);
      setTrees(list);
      setNodes(
        canvasNodes.map((node) => ({
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
    let disposed = false;
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
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<AgentToolEvent>("agent-tool-result", (event) => {
      const payload = event.payload;
      const activeRequest = activeRequestsRef.current[payload.nodeId];
      if (!activeRequest || activeRequest !== payload.requestId) {
        return;
      }
      setAgentToolEvents((current) => ({
        ...current,
        [payload.nodeId]: [...(current[payload.nodeId] ?? []), payload],
      }));
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<KnowledgeWatchEvent>("knowledge-watch-indexed", (event) => {
      const payload = event.payload;
      if (!payload.ok) {
        const error =
          payload.content && typeof payload.content === "object"
            ? String((payload.content as Record<string, unknown>).error ?? "Watcher failed")
            : "Watcher failed";
        setStatusText(error);
        return;
      }
      const content = payload.content as Record<string, unknown>;
      const indexed = Array.isArray(content.indexed) ? content.indexed.length : 0;
      const errors = Array.isArray(content.errors) ? content.errors.length : 0;
      if (indexed > 0 || errors > 0) {
        setStatusText(`Watched knowledge indexed: ${indexed} path(s), ${errors} error(s)`);
      }
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      disposed = true;
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
      setChatHomeVisible(false);
      await loadCanvas(created.root_node_id, created.tree_id);
    } catch (e) {
      setStatusText(String(e));
    }
  }, [askText, loadCanvas]);

  const handleSelectTree = useCallback(
    async (treeId: string) => {
      const tree = trees.find((item) => item.id === treeId);
      activeTreeIdRef.current = treeId;
      setActiveTreeId(treeId);
      setChatHomeVisible(false);
      await loadCanvas(tree?.last_node_id ?? null, treeId);
    },
    [loadCanvas, trees],
  );

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
      setChatHomeVisible(false);
      setTargetMessageId("");
      selectLocally(nodeId);
      try {
        await api.setCurrentNode(treeId, nodeId);
      } catch (e) {
        setStatusText(String(e));
      }
    },
    [selectLocally],
  );

  const handleOpenTarget = useCallback(
    async (target: string) => {
      const trimmed = target.trim();
      if (!trimmed) return;
      try {
        const resolved = await api.resolveTarget(trimmed);
        if (resolved.kind === "chat" && resolved.treeId && resolved.nodeId) {
          setSettingsOpen(false);
          setChatsOpen(false);
          setProjectsOpen(false);
          setTasksOpen(false);
          setTerminalOpen(false);
          setSearchOpen(false);
          setMemoryOpen(false);
          setKnowledgeOpen(false);
          setChatHomeVisible(false);
          await api.setCurrentNode(resolved.treeId, resolved.nodeId);
          await loadCanvas(resolved.nodeId, resolved.treeId);
          setTargetMessageId(resolved.messageId ?? "");
          await loadMessages(resolved.treeId, resolved.nodeId);
          return;
        }
        const openTarget =
          resolved.kind === "url"
            ? resolved.target
            : resolved.absolutePath ?? resolved.path ?? resolved.target;
        if (!openTarget) {
          throw new Error("Target is not openable.");
        }
        await openShell(openTarget);
      } catch (e) {
        setStatusText(String(e));
      }
    },
    [loadCanvas, loadMessages],
  );

  const handleOpenFolder = useCallback(async (path: string) => {
    try {
      await openShell(path);
    } catch (e) {
      setStatusText(String(e));
    }
  }, []);

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
        await loadCanvas(node.id, node.treeId);
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
        await loadCanvas(childId, node.treeId);
      } catch (e) {
        setStatusText(String(e));
      }
    },
    [askText, loadCanvas],
  );

  const handleSetNodeColor = useCallback(
    async (node: CanvasLayoutNode, color: string | null, includeDescendants: boolean) => {
      try {
        await api.setNodeColor(node.treeId, node.id, color, includeDescendants);
        await loadCanvas(node.id, node.treeId);
      } catch (e) {
        setStatusText(String(e));
      }
    },
    [loadCanvas],
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
        await loadCanvas(result.parent_id, node.treeId);
      } catch (e) {
        setStatusText(String(e));
      }
    },
    [askConfirm, loadCanvas],
  );

  const applyAssistantReply = useCallback(
    async (treeId: string, nodeId: string, reply: AssistantReplyResult) => {
      const nextNodeId = reply.selected_node_id || nodeId;
      const createdCount = reply.created_branches.length;
      const currentSelection = selectedNodeIdRef.current;
      const createdBranchIds = new Set(reply.created_branches.map((branch) => branch.id));
      const branchWasCreated = createdCount > 0 && createdBranchIds.has(nextNodeId);
      const shouldAdoptReplySelection =
        branchWasCreated || currentSelection === nodeId || currentSelection === nextNodeId;

      if (shouldAdoptReplySelection) {
        if (branchWasCreated) {
          setTreeVisible(true);
        }
        await loadMessages(treeId, nextNodeId);
      }
      await loadCanvas(
        shouldAdoptReplySelection ? nextNodeId : currentSelection,
        shouldAdoptReplySelection ? treeId : activeTreeIdRef.current,
      );
      if (createdCount > 0) {
        setStatusText(
          createdCount === 1 ? "Created 1 branch" : `Created ${createdCount} branches`,
        );
      }
    },
    [loadCanvas, loadMessages],
  );

  const sendMessageToNode = useCallback(
    async (treeId: string, nodeId: string, content: string) => {
      if (activeRequestsRef.current[nodeId]) return;

      const requestId = crypto.randomUUID();
      setActiveRequests((current) => ({ ...current, [nodeId]: requestId }));
      setStreamingText((current) => ({ ...current, [nodeId]: "" }));
      setAgentToolEvents((current) => ({ ...current, [nodeId]: [] }));
      setChatError("");

      try {
        const userMessage = await api.addUserMessage(treeId, nodeId, content);
        if (selectedNodeIdRef.current === nodeId) {
          setMessages((current) => [...current, userMessage]);
        }
        await loadCanvas(nodeId, treeId);

        const reply = await api.generateAssistantReply(treeId, nodeId, requestId);
        await applyAssistantReply(treeId, nodeId, reply);
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
    [applyAssistantReply, loadCanvas, loadMessages],
  );

  const createInitialTree = useCallback(
    async (content: string): Promise<TreeCreated> => {
      const created = await api.createTree(titleFromPrompt(content));
      await api.setCurrentNode(created.tree_id, created.root_node_id);
      setChatHomeVisible(false);
      await loadCanvas(created.root_node_id, created.tree_id);
      return created;
    },
    [loadCanvas],
  );

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!selectedNode || !selectedNode.is_leaf) return;
      setChatHomeVisible(false);
      await sendMessageToNode(selectedNode.treeId, selectedNode.id, content);
    },
    [selectedNode, sendMessageToNode],
  );

  const handleStartChat = useCallback(
    async (content: string) => {
      setStartingChat(true);
      setChatError("");
      try {
        const created = await createInitialTree(content);
        await sendMessageToNode(created.tree_id, created.root_node_id, content);
      } catch (e) {
        setChatError(String(e));
      } finally {
        setStartingChat(false);
      }
    },
    [createInitialTree, sendMessageToNode],
  );

  const handleStartBranchSplit = useCallback(
    async (content: string) => {
      let createdNodeId = "";
      setStartingChat(true);
      setChatError("");
      try {
        const created = await createInitialTree(content);
        const treeId = created.tree_id;
        const nodeId = created.root_node_id;
        createdNodeId = nodeId;
        setActiveRequests((current) => ({ ...current, [nodeId]: "force-branch-split" }));
        setAgentToolEvents((current) => ({ ...current, [nodeId]: [] }));

        const userMessage = await api.addUserMessage(treeId, nodeId, content);
        if (selectedNodeIdRef.current === nodeId) {
          setMessages([userMessage]);
        }
        await loadCanvas(nodeId, treeId);

        const reply = await api.forceBranchSplit(treeId, nodeId);
        await applyAssistantReply(treeId, nodeId, reply);
      } catch (e) {
        setChatError(String(e));
      } finally {
        setStartingChat(false);
        if (createdNodeId) {
          setActiveRequests((current) => {
            const next = { ...current };
            delete next[createdNodeId];
            return next;
          });
        }
      }
    },
    [applyAssistantReply, createInitialTree, loadCanvas],
  );

  const handleStartConnector = useCallback(
    async (content: string) => {
      let createdNodeId = "";
      setStartingChat(true);
      setChatError("");
      try {
        const created = await createInitialTree(content);
        const treeId = created.tree_id;
        const nodeId = created.root_node_id;
        createdNodeId = nodeId;
        setActiveRequests((current) => ({ ...current, [nodeId]: "connector" }));
        setAgentToolEvents((current) => ({ ...current, [nodeId]: [] }));

        const userMessage = await api.addUserMessage(treeId, nodeId, content);
        if (selectedNodeIdRef.current === nodeId) {
          setMessages([userMessage]);
        }
        await loadCanvas(nodeId, treeId);

        const connector = await api.proposeConnector(treeId, nodeId, content);
        await loadConnectors();
        setKnowledgeOpen(false);
        setSettingsOpen(true);
        setStatusText(`Connector draft created: ${connector.manifest.name}`);
      } catch (e) {
        setChatError(String(e));
      } finally {
        setStartingChat(false);
        if (createdNodeId) {
          setActiveRequests((current) => {
            const next = { ...current };
            delete next[createdNodeId];
            return next;
          });
        }
      }
    },
    [createInitialTree, loadCanvas, loadConnectors],
  );

  const handleConfirmBranches = useCallback(
    async (message: Message) => {
      const nodeId = message.node_id;
      const treeId = message.tree_id;
      if (activeRequestsRef.current[nodeId]) return;

      setActiveRequests((current) => ({ ...current, [nodeId]: "confirm-branches" }));
      setAgentToolEvents((current) => ({ ...current, [nodeId]: [] }));
      setChatError("");
      try {
        const reply = await api.confirmPendingBranches(treeId, nodeId);
        await applyAssistantReply(treeId, nodeId, reply);
      } catch (e) {
        setChatError(String(e));
        if (selectedNodeIdRef.current === nodeId) {
          await loadMessages(treeId, nodeId);
        }
        throw e;
      } finally {
        setActiveRequests((current) => {
          const next = { ...current };
          delete next[nodeId];
          return next;
        });
      }
    },
    [applyAssistantReply, loadMessages],
  );

  const handleEditMessage = useCallback(
    async (message: Message, content: string) => {
      const treeId = message.tree_id;
      const nodeId = message.node_id;
      if (activeRequestsRef.current[nodeId]) return;

      const requestId = crypto.randomUUID();
      setActiveRequests((current) => ({ ...current, [nodeId]: requestId }));
      setStreamingText((current) => ({ ...current, [nodeId]: "" }));
      setAgentToolEvents((current) => ({ ...current, [nodeId]: [] }));
      setChatError("");

      try {
        const edited = await api.editUserMessage(treeId, message.id, content);
        if (selectedNodeIdRef.current === nodeId) {
          setMessages((current) => {
            const index = current.findIndex((item) => item.id === message.id);
            if (index === -1) return current;
            return [...current.slice(0, index), edited];
          });
        }
        await loadCanvas(nodeId, treeId);

        const reply = await api.generateAssistantReply(treeId, nodeId, requestId);
        await applyAssistantReply(treeId, nodeId, reply);
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
    [applyAssistantReply, loadCanvas, loadMessages],
  );

  const handleRegenerateMessage = useCallback(
    async (message: Message) => {
      const treeId = message.tree_id;
      const nodeId = message.node_id;
      if (activeRequestsRef.current[nodeId]) return;

      const requestId = crypto.randomUUID();
      setActiveRequests((current) => ({ ...current, [nodeId]: requestId }));
      setStreamingText((current) => ({ ...current, [nodeId]: "" }));
      setAgentToolEvents((current) => ({ ...current, [nodeId]: [] }));
      setChatError("");

      try {
        const reply = await api.regenerateAssistantReply(treeId, message.id, requestId);
        await applyAssistantReply(treeId, nodeId, reply);
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
    [applyAssistantReply, loadMessages],
  );

  const handleForceBranchSplit = useCallback(
    async (content: string) => {
      if (!selectedNode || !selectedNode.is_leaf) return;

      const treeId = selectedNode.treeId;
      const nodeId = selectedNode.id;
      if (activeRequestsRef.current[nodeId]) return;

      setChatHomeVisible(false);
      setActiveRequests((current) => ({ ...current, [nodeId]: "force-branch-split" }));
      setAgentToolEvents((current) => ({ ...current, [nodeId]: [] }));
      setChatError("");
      try {
        if (content) {
          const userMessage = await api.addUserMessage(treeId, nodeId, content);
          if (selectedNodeIdRef.current === nodeId) {
            setMessages((current) => [...current, userMessage]);
          }
          await loadCanvas(nodeId, treeId);
        }

        const reply = await api.forceBranchSplit(treeId, nodeId);
        await applyAssistantReply(treeId, nodeId, reply);
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
      }
    },
    [applyAssistantReply, loadCanvas, loadMessages, selectedNode],
  );

  const handleProposeConnector = useCallback(
    async (content: string) => {
      if (!selectedNode || !selectedNode.is_leaf) return;
      const nodeId = selectedNode.id;
      const treeId = selectedNode.treeId;
      if (activeRequestsRef.current[nodeId]) return;

      setActiveRequests((current) => ({ ...current, [nodeId]: "connector" }));
      setAgentToolEvents((current) => ({ ...current, [nodeId]: [] }));
      setChatError("");
      try {
        const connector = await api.proposeConnector(treeId, nodeId, content);
        await loadConnectors();
        setKnowledgeOpen(false);
        setSettingsOpen(true);
        setStatusText(`Connector draft created: ${connector.manifest.name}`);
      } catch (e) {
        setChatError(String(e));
      } finally {
        setActiveRequests((current) => {
          const next = { ...current };
          delete next[nodeId];
          return next;
        });
      }
    },
    [loadConnectors, selectedNode],
  );

  const handleSetConnectorEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await api.setConnectorEnabled(id, enabled);
        await loadConnectors();
      } catch (e) {
        setStatusText(String(e));
      }
    },
    [loadConnectors],
  );

  const handleSaveSettings = useCallback(async (input: SettingsInput) => {
    try {
      const saved = await api.saveSettings(input);
      setSettings(saved);
      setSettingsDraft(saved);
      setChatError("");
    } catch (e) {
      setChatError(String(e));
      throw e;
    }
  }, []);

  const handleThemeChange = useCallback(
    async (theme: ThemeName) => {
      const nextSettings = { ...settings, theme };
      setSettings(nextSettings);
      setSettingsDraft((current) => ({ ...current, theme }));
      setChatError("");
      try {
        const saved = await api.saveSettings(nextSettings);
        setSettings(saved);
        setSettingsDraft((current) => ({ ...current, theme: saved.theme }));
      } catch (e) {
        setChatError(String(e));
      }
    },
    [settings],
  );

  const saveSettings = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setSavingSettings(true);
      try {
        await handleSaveSettings(settingsDraft);
        setSettingsOpen(false);
      } finally {
        setSavingSettings(false);
      }
    },
    [handleSaveSettings, settingsDraft],
  );

  return (
    <main className="no-drag relative flex h-screen flex-col overflow-hidden bg-[color:var(--app-bg)] text-[color:var(--text)]">
      <div className="drag-region absolute left-0 right-0 top-0 z-20 h-2" />
      <header
        className={`no-drag relative z-40 flex h-12 shrink-0 items-center bg-[color:var(--app-bg)] px-3 ${
          chatHomeVisible ? "" : "border-b border-[color:var(--border)]"
        }`}
      >
        <div
          className={`absolute left-3 top-2 flex min-w-0 items-center justify-start gap-2 ${
            titlebarNeedsTrafficSpace ? "pl-0 sm:pl-[72px]" : "pl-0"
          }`}
        >
          {titlebarNeedsTrafficSpace && (
            <div className="drag-region mr-1 hidden h-8 w-2 shrink-0 sm:flex" />
          )}
          <div className="relative">
            <TopBarButton
              label="Chats"
              active={chatsOpen}
              onClick={() => {
                setSettingsOpen(false);
                setProjectsOpen(false);
                setTasksOpen(false);
                setTerminalOpen(false);
                setSearchOpen(false);
                setMemoryOpen(false);
                setKnowledgeOpen(false);
                setChatsOpen((value) => !value);
              }}
            >
              <ChatsIcon />
            </TopBarButton>
            {chatsOpen && (
              <ChatsPanel
                trees={trees}
                activeTreeId={activeTreeId}
                onCreateRoot={() => {
                  setChatsOpen(false);
                  void handleCreateRoot();
                }}
                onSelectTree={(treeId) => {
                  setChatsOpen(false);
                  void handleSelectTree(treeId);
                }}
              />
            )}
          </div>
          <TopBarButton
            label="Projects"
            active={projectsOpen}
            onClick={() => {
              setSettingsOpen(false);
              setChatsOpen(false);
              setTasksOpen(false);
              setTerminalOpen(false);
              setSearchOpen(false);
              setMemoryOpen(false);
              setKnowledgeOpen(false);
              setProjectsOpen((value) => !value);
            }}
          >
            <ProjectIcon />
          </TopBarButton>
          {projectsOpen && (
            <ProjectWizardPanel
              onClose={() => setProjectsOpen(false)}
              onOpenFolder={handleOpenFolder}
              onAskAgent={handleStartChat}
            />
          )}
          <TopBarButton
            label="Tasks"
            active={tasksOpen}
            onClick={() => {
              setSettingsOpen(false);
              setChatsOpen(false);
              setProjectsOpen(false);
              setTerminalOpen(false);
              setSearchOpen(false);
              setMemoryOpen(false);
              setKnowledgeOpen(false);
              setTasksOpen((value) => !value);
            }}
          >
            <TasksIcon />
          </TopBarButton>
          {tasksOpen && (
            <AgentTasksPanel
              treeId={selectedTreeId}
              nodeId={selectedCanvasNodeId}
              onClose={() => setTasksOpen(false)}
            />
          )}
          <TopBarButton
            label="Terminal"
            active={terminalOpen}
            onClick={() => {
              setSettingsOpen(false);
              setChatsOpen(false);
              setProjectsOpen(false);
              setTasksOpen(false);
              setSearchOpen(false);
              setMemoryOpen(false);
              setKnowledgeOpen(false);
              setTerminalOpen((value) => !value);
            }}
          >
            <TerminalIcon />
          </TopBarButton>
          {terminalOpen && <TerminalPanel onClose={() => setTerminalOpen(false)} />}
          <TopBarButton
            label="Search"
            active={searchOpen}
            onClick={() => {
              setSettingsOpen(false);
              setChatsOpen(false);
              setProjectsOpen(false);
              setTasksOpen(false);
              setTerminalOpen(false);
              setMemoryOpen(false);
              setKnowledgeOpen(false);
              setSearchOpen((value) => !value);
            }}
          >
            <SearchIcon />
          </TopBarButton>
          {searchOpen && (
            <SearchPanel
              onClose={() => setSearchOpen(false)}
              onOpenTarget={handleOpenTarget}
            />
          )}
          {!chatHomeVisible && (
            <TopBarButton
              label={treeVisible ? "Focus" : "Tree"}
              onClick={() => {
                setChatsOpen(false);
                setProjectsOpen(false);
                setTasksOpen(false);
                setTerminalOpen(false);
                setSearchOpen(false);
                setTreeVisible((value) => {
                  const nextVisible = !value;
                  if (nextVisible) {
                    setChatHomeVisible(false);
                  }
                  return nextVisible;
                });
              }}
            >
              <PanelIcon />
            </TopBarButton>
          )}
          {!chatHomeVisible && (
            <div className="hidden h-8 max-w-[168px] shrink-0 items-center truncate whitespace-nowrap rounded-full border border-[color:var(--border)] px-3 text-xs text-[color:var(--muted)] lg:inline-flex">
              {settings.model || DEFAULT_SETTINGS.model}
            </div>
          )}
        </div>
        {!chatHomeVisible && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 flex max-w-[min(560px,42vw)] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center leading-tight">
            <div className="max-w-full truncate text-sm font-semibold text-[color:var(--text)]">
              {titlebarTitle}
            </div>
            {titlebarSubtitle && (
              <div className="mt-0.5 max-w-full truncate text-[11px] text-[color:var(--muted)]">
                {titlebarSubtitle}
              </div>
            )}
          </div>
        )}
        <div className="absolute right-3 top-2 flex min-w-0 items-center justify-end gap-2">
          <TopBarButton
            label="Memory"
            active={memoryOpen}
            tooltipAlign="right"
            onClick={() => {
              setSettingsOpen(false);
              setChatsOpen(false);
              setProjectsOpen(false);
              setTasksOpen(false);
              setTerminalOpen(false);
              setSearchOpen(false);
              setKnowledgeOpen(false);
              setMemoryOpen((value) => !value);
            }}
          >
            <MemoryIcon />
          </TopBarButton>
          {memoryOpen && (
            <MemoryPanel
              onClose={() => setMemoryOpen(false)}
              onOpenTarget={handleOpenTarget}
            />
          )}
          <TopBarButton
            label="Knowledge"
            active={knowledgeOpen}
            tooltipAlign="right"
            onClick={() => {
              setSettingsOpen(false);
              setChatsOpen(false);
              setProjectsOpen(false);
              setTasksOpen(false);
              setTerminalOpen(false);
              setSearchOpen(false);
              setMemoryOpen(false);
              setKnowledgeOpen((value) => !value);
            }}
          >
            <KnowledgeIcon />
          </TopBarButton>
          {knowledgeOpen && (
            <KnowledgePanel
              onClose={() => setKnowledgeOpen(false)}
              onOpenTarget={handleOpenTarget}
            />
          )}
          <TopBarButton
            label="Settings"
            active={settingsOpen}
            tooltipAlign="right"
            onClick={() => {
              setSettingsDraft(settings);
              setChatsOpen(false);
              setProjectsOpen(false);
              setTasksOpen(false);
              setTerminalOpen(false);
              setSearchOpen(false);
              setMemoryOpen(false);
              setKnowledgeOpen(false);
              setSettingsOpen((value) => !value);
            }}
          >
            <SettingsIcon />
          </TopBarButton>
          {settingsOpen && (
            <SettingsPanel
              settings={settings}
              settingsDraft={settingsDraft}
              saving={savingSettings}
              connectors={connectors}
              connectorsLoading={connectorsLoading}
              onChange={setSettingsDraft}
              onThemeChange={handleThemeChange}
              onToggleConnector={handleSetConnectorEnabled}
              onCancel={() => {
                setSettingsDraft(settings);
                setSettingsOpen(false);
              }}
              onSubmit={saveSettings}
            />
          )}
        </div>
      </header>
      <div className="min-h-0 flex flex-1 flex-col overflow-hidden md:flex-row">
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-sm text-[color:var(--muted)]">
              Loading
            </div>
          }
        >
          {treeVisible && (
            <section className="min-h-[240px] min-w-0 shrink-0 overflow-hidden border-b border-[color:var(--border)] md:min-h-0 md:flex-1 md:border-b-0">
              <TreeCanvas
                nodes={nodes}
                loading={loading}
                statusText={statusText}
                onCreateRoot={handleCreateRoot}
                onSelectNode={handleSelectNode}
                onRenameNode={handleRenameNode}
                onCreateChild={handleCreateChild}
                onSetNodeColor={handleSetNodeColor}
                onDeleteNode={handleDeleteNode}
              />
            </section>
          )}
          {treeVisible && !compactLayout && (
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
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[color:var(--border)] transition-colors group-hover:bg-[color:var(--selected)] group-focus-visible:bg-[color:var(--selected)]" />
            </div>
          )}
          <ChatPanel
            selectedNode={chatHomeVisible ? null : selectedNode}
            messages={chatHomeVisible ? [] : messages}
            loading={chatHomeVisible ? false : messagesLoading}
            sending={startingChat || (!chatHomeVisible && selectedNodeIsSending)}
            streamingText={chatHomeVisible ? "" : selectedStreamingText}
            agentToolEvents={chatHomeVisible ? [] : selectedAgentToolEvents}
            canWrite={Boolean(!chatHomeVisible && selectedNode?.is_leaf)}
            canStartChat={chatHomeVisible}
            fullWidth={!treeVisible || compactLayout}
            error={chatError}
            targetMessageId={targetMessageId}
            panelWidth={treeVisible && !compactLayout ? chatWidth : undefined}
            onSend={handleSendMessage}
            onStartChat={handleStartChat}
            onStartBranchSplit={handleStartBranchSplit}
            onStartConnector={handleStartConnector}
            onEditMessage={handleEditMessage}
            onRegenerateMessage={handleRegenerateMessage}
            onConfirmBranches={handleConfirmBranches}
            onForceBranchSplit={handleForceBranchSplit}
            onProposeConnector={handleProposeConnector}
            onOpenTarget={handleOpenTarget}
          />
        </Suspense>
      </div>
      {onboardingOpen && (
        <OnboardingPanel
          onClose={dismissOnboarding}
          onOpenSettings={() => {
            dismissOnboarding();
            setSettingsDraft(settings);
            setChatsOpen(false);
            setProjectsOpen(false);
            setTasksOpen(false);
            setTerminalOpen(false);
            setSearchOpen(false);
            setMemoryOpen(false);
            setKnowledgeOpen(false);
            setSettingsOpen(true);
          }}
          onOpenProjects={() => {
            dismissOnboarding();
            setSettingsOpen(false);
            setChatsOpen(false);
            setTasksOpen(false);
            setTerminalOpen(false);
            setSearchOpen(false);
            setMemoryOpen(false);
            setKnowledgeOpen(false);
            setProjectsOpen(true);
          }}
        />
      )}
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
    </main>
  );
}

function OnboardingPanel({
  onClose,
  onOpenSettings,
  onOpenProjects,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenProjects: () => void;
}) {
  return (
    <div className="no-drag fixed inset-0 z-[70] flex items-center justify-center bg-black/28 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
        <div className="border-b border-[color:var(--border)] px-5 py-4">
          <div className="text-base font-semibold text-[color:var(--text)]">ino-agent</div>
          <div className="mt-1 text-sm leading-6 text-[color:var(--muted)]">
            Local workspace for projects, agent tasks, memory, search, and visual explanations.
          </div>
        </div>
        <div className="grid gap-2 p-4">
          <OnboardingStep
            label="1"
            title="Set model access"
            text="Save endpoint, model, API key, and theme in Settings."
          />
          <OnboardingStep
            label="2"
            title="Create or inspect work"
            text="Use Projects, Tasks, Terminal, Search, Memory, and Knowledge from the top bar."
          />
          <OnboardingStep
            label="3"
            title="Keep local data private"
            text="Chats, memory, command history, paths, and API keys stay in the local SQLite database."
          />
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-[color:var(--border)] px-4 py-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-full border border-[color:var(--border)] px-4 text-sm text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)]"
          >
            Start
          </button>
          <button
            type="button"
            onClick={onOpenProjects}
            className="h-9 rounded-full border border-[color:var(--border)] px-4 text-sm text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)]"
          >
            Open Projects
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="h-9 rounded-full bg-[color:var(--button)] px-4 text-sm font-medium text-[color:var(--button-text)] transition-opacity hover:opacity-90"
          >
            Set Model
          </button>
        </div>
      </div>
    </div>
  );
}

function OnboardingStep({
  label,
  title,
  text,
}: {
  label: string;
  title: string;
  text: string;
}) {
  return (
    <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--selected)] text-xs font-semibold text-[color:var(--text)]">
        {label}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-[color:var(--text)]">{title}</div>
        <div className="mt-0.5 text-xs leading-5 text-[color:var(--muted)]">{text}</div>
      </div>
    </div>
  );
}

function TopBarButton({
  label,
  active = false,
  tooltipAlign = "center",
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  tooltipAlign?: "center" | "right";
  onClick: () => void;
  children: ReactNode;
}) {
  const tooltipPosition =
    tooltipAlign === "right" ? "right-0" : "left-1/2 -translate-x-1/2";

  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)] focus-visible:bg-[color:var(--selected)] focus-visible:text-[color:var(--text)] focus-visible:outline-none ${
        active ? "bg-[color:var(--selected)] text-[color:var(--text)]" : "text-[color:var(--muted)]"
      }`}
    >
      {children}
      <span
        className={`pointer-events-none absolute top-full z-[80] mt-2 whitespace-nowrap rounded-lg border border-[color:var(--border)] bg-[color:var(--panel)] px-2 py-1 text-xs font-medium text-[color:var(--text)] opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.14)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${tooltipPosition}`}
      >
        {label}
      </span>
    </button>
  );
}

function titleFromPrompt(content: string) {
  const firstLine =
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("[Attached file:")) ?? "New chat";
  const normalized = firstLine.replace(/\s+/g, " ");
  return normalized.length > 56 ? `${normalized.slice(0, 53).trim()}...` : normalized;
}

function ChatsPanel({
  trees,
  activeTreeId,
  onCreateRoot,
  onSelectTree,
}: {
  trees: TreeSummary[];
  activeTreeId: string | null;
  onCreateRoot: () => void;
  onSelectTree: (treeId: string) => void;
}) {
  const orderedTrees = [...trees].sort((a, b) => b.updated_at - a.updated_at);

  return (
    <div className="no-drag fixed left-3 right-3 top-12 z-50 max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] shadow-[0_12px_40px_rgba(0,0,0,0.14)] sm:absolute sm:left-0 sm:right-auto sm:top-10 sm:w-[300px]">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[color:var(--text)]">Chats</div>
          <div className="truncate text-[11px] text-[color:var(--muted)]">Latest first</div>
        </div>
        <button
          type="button"
          onClick={onCreateRoot}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[color:var(--border)] text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)]"
          aria-label="New chat"
          title="New chat"
        >
          <PlusIcon />
        </button>
      </div>
      <div className="max-h-[360px] overflow-y-auto p-1.5">
        {orderedTrees.length === 0 ? (
          <div className="px-3 py-3 text-sm text-[color:var(--muted)]">No chats</div>
        ) : (
          orderedTrees.map((tree) => {
            const active = tree.id === activeTreeId;
            return (
              <button
                key={tree.id}
                type="button"
                onClick={() => onSelectTree(tree.id)}
                className={`flex min-h-[48px] w-full min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${
                  active
                    ? "bg-[color:var(--selected)] text-[color:var(--text)]"
                    : "text-[color:var(--text)] hover:bg-[color:var(--panel-soft)]"
                }`}
              >
                <span
                  className={`h-7 w-1.5 shrink-0 rounded-full ${
                    active ? "bg-[color:var(--accent)]" : "bg-[color:var(--muted)]/45"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{tree.title}</span>
                  <span className="block truncate text-[11px] text-[color:var(--muted)]">
                    {tree.message_count} messages
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function SettingsPanel({
  settings,
  settingsDraft,
  saving,
  connectors,
  connectorsLoading,
  onChange,
  onThemeChange,
  onToggleConnector,
  onCancel,
  onSubmit,
}: {
  settings: ChatSettings;
  settingsDraft: ChatSettings;
  saving: boolean;
  connectors: ConnectorSummary[];
  connectorsLoading: boolean;
  onChange: (next: ChatSettings) => void;
  onThemeChange: (theme: ThemeName) => void;
  onToggleConnector: (id: string, enabled: boolean) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const inputClass =
    "mt-1 h-9 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 text-sm text-[color:var(--text)] outline-none transition-shadow placeholder:text-[color:var(--muted)] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.035)]";

  return (
    <form
      onSubmit={onSubmit}
      className="no-drag fixed left-3 right-3 top-12 z-50 max-w-[calc(100vw-24px)] rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] p-3 shadow-[0_12px_40px_rgba(0,0,0,0.14)] sm:absolute sm:left-auto sm:right-0 sm:top-10 sm:w-[420px]"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-[color:var(--text)]">Agent settings</div>
          <div className="text-xs text-[color:var(--muted)]">
            Appearance, model and API access
          </div>
        </div>
        <div className="rounded-full border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]">
          {settings.api_key ? "API connected" : "No API key"}
        </div>
      </div>
      <div className="grid gap-2">
        <label className="block text-xs text-[color:var(--muted)]">
          Theme
          <select
            value={settingsDraft.theme}
            onChange={(event) => onThemeChange(event.target.value as ThemeName)}
            className={inputClass}
          >
            {THEME_NAMES.map((themeName) => (
              <option key={themeName} value={themeName}>
                {themeName}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-[color:var(--muted)]">
          Model
          <input
            type="text"
            value={settingsDraft.model}
            onChange={(event) => onChange({ ...settingsDraft, model: event.target.value })}
            className={inputClass}
            placeholder={DEFAULT_SETTINGS.model}
          />
        </label>
        <label className="block text-xs text-[color:var(--muted)]">
          API key
          <input
            type="password"
            value={settingsDraft.api_key}
            onChange={(event) => onChange({ ...settingsDraft, api_key: event.target.value })}
            className={inputClass}
            placeholder="sk-..."
          />
        </label>
        <label className="block text-xs text-[color:var(--muted)]">
          Endpoint
          <input
            type="text"
            value={settingsDraft.endpoint}
            onChange={(event) => onChange({ ...settingsDraft, endpoint: event.target.value })}
            className={inputClass}
            placeholder={DEFAULT_SETTINGS.endpoint}
          />
        </label>
      </div>
      <div className="mt-4 border-t border-[color:var(--border)] pt-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-[color:var(--text)]">Connectors</div>
            <div className="text-xs text-[color:var(--muted)]">
              Generated skills stay disabled until enabled
            </div>
          </div>
          <div className="rounded-full border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]">
            {connectorsLoading ? "Loading" : connectors.length}
          </div>
        </div>
        <div className="max-h-[240px] space-y-2 overflow-y-auto pr-1">
          {connectors.length === 0 ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-2 text-xs text-[color:var(--muted)]">
              No connector drafts yet.
            </div>
          ) : (
            connectors.map((connector) => (
              <div
                key={`${connector.pending ? "pending" : "active"}-${connector.manifest.id}`}
                className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[color:var(--text)]">
                      {connector.manifest.name}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-[color:var(--muted)]">
                      {connector.manifest.description}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onToggleConnector(connector.manifest.id, !connector.manifest.enabled)
                    }
                    className={`h-7 shrink-0 rounded-full px-2.5 text-xs font-medium transition-colors ${
                      connector.manifest.enabled
                        ? "bg-[color:var(--selected)] text-[color:var(--text)]"
                        : "bg-[color:var(--button)] text-[color:var(--button-text)]"
                    }`}
                  >
                    {connector.manifest.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {connector.pending && (
                    <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
                      pending
                    </span>
                  )}
                  {connector.manifest.schedule && (
                    <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
                      {connector.manifest.schedule}
                    </span>
                  )}
                  {connector.manifest.permissions.slice(0, 4).map((permission) => (
                    <span
                      key={permission}
                      className="max-w-full truncate rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]"
                    >
                      {permission}
                    </span>
                  ))}
                </div>
                <div className="mt-2 truncate text-[11px] text-[color:var(--muted)]">
                  {connector.path}
                </div>
                {connector.files.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-[color:var(--muted)]">
                      Files
                    </summary>
                    <div className="mt-2 space-y-2">
                      {connector.files.map((file) => (
                        <div
                          key={file.path}
                          className="overflow-hidden rounded-lg border border-[color:var(--border)]"
                        >
                          <div className="border-b border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]">
                            {file.path}
                          </div>
                          <pre className="max-h-36 overflow-auto bg-[color:var(--panel)] px-2 py-2 text-[11px] leading-4 text-[color:var(--text)]">
                            {file.content}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-full px-3 text-xs text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)]"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="h-8 rounded-full bg-[color:var(--button)] px-3 text-xs font-medium text-[color:var(--button-text)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving" : "Save"}
        </button>
      </div>
    </form>
  );
}

function MemoryIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="3" />
      <circle cx="5" cy="7" r="2" />
      <circle cx="19" cy="7" r="2" />
      <circle cx="7" cy="19" r="2" />
      <circle cx="17" cy="19" r="2" />
      <path d="M7 8.5 10 11M14 11l3-2.5M10.5 14.5 8 17.5M13.5 14.5 16 17.5" />
    </svg>
  );
}

function KnowledgeIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
      <path d="M4 5.5v16M8 7h8M8 11h7M8 15h5" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2.1 2.1 0 0 1-2.97 2.97l-.04-.04a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.09 1.65V21a2.1 2.1 0 0 1-4.2 0v-.06a1.8 1.8 0 0 0-1.09-1.65 1.8 1.8 0 0 0-1.98.36l-.04.04a2.1 2.1 0 0 1-2.97-2.97l.04-.04A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-1.65-1.09H3a2.1 2.1 0 0 1 0-4.2h.06A1.8 1.8 0 0 0 4.7 8.62a1.8 1.8 0 0 0-.36-1.98l-.04-.04a2.1 2.1 0 0 1 2.97-2.97l.04.04a1.8 1.8 0 0 0 1.98.36A1.8 1.8 0 0 0 10.38 2.4V2.3a2.1 2.1 0 0 1 4.2 0v.06a1.8 1.8 0 0 0 1.09 1.65 1.8 1.8 0 0 0 1.98-.36l.04-.04a2.1 2.1 0 0 1 2.97 2.97l-.04.04a1.8 1.8 0 0 0-.36 1.98 1.8 1.8 0 0 0 1.65 1.09H22a2.1 2.1 0 0 1 0 4.2h-.06A1.8 1.8 0 0 0 19.4 15Z" />
    </svg>
  );
}

function ChatsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M7 8h10" />
      <path d="M7 12h7" />
      <path d="M5 19a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-8l-4 3v-3Z" />
    </svg>
  );
}

function ProjectIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <path d="M8 12h8M8 15h5" />
    </svg>
  );
}

function TasksIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="m4 6 1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5Z" />
      <path d="m8 9 3 3-3 3M13 15h3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
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

function PanelIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M10 5v14" />
    </svg>
  );
}
