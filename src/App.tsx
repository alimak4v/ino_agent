import {
  type FormEvent,
  type ReactNode,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
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
import {
  INTERFACE_LANGUAGES,
  LANGUAGE_LABELS,
  uiText,
  type InterfaceLanguage,
} from "./lib/i18n";
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
  language: "English",
  system_prompt: "",
};
const THEME_NAMES = Object.keys(THEMES) as ThemeName[];
const ONBOARDING_STORAGE_KEY = "ino-agent:onboarding:v1";
const SIDEBAR_PROFILE_STORAGE_KEY = "ino-agent:sidebar-profile:v1";

interface KnowledgeWatchEvent {
  ok: boolean;
  content: unknown;
}

type AuxPanel = "chats" | "projects" | "tasks" | "terminal" | "search" | "memory" | "knowledge" | "settings";

interface PanelSelectTreeEvent {
  treeId: string;
}

interface PanelOpenTargetEvent {
  target: string;
}

interface PanelStartChatEvent {
  content: string;
}

interface SidebarProfile {
  name: string;
  avatarDataUrl: string;
}

const AUX_PANEL_CONFIG: Record<
  AuxPanel,
  { label: string; title: string; width: number; height: number; minWidth: number; minHeight: number }
> = {
  chats: { label: "panel-chats", title: "Chats", width: 320, height: 500, minWidth: 300, minHeight: 380 },
  projects: { label: "panel-projects", title: "Projects", width: 740, height: 560, minWidth: 640, minHeight: 460 },
  tasks: { label: "panel-tasks", title: "Tasks", width: 720, height: 540, minWidth: 620, minHeight: 440 },
  terminal: { label: "panel-terminal", title: "Terminal", width: 720, height: 520, minWidth: 620, minHeight: 420 },
  search: { label: "panel-search", title: "Search", width: 740, height: 560, minWidth: 620, minHeight: 460 },
  memory: { label: "panel-memory", title: "Memory", width: 760, height: 580, minWidth: 640, minHeight: 480 },
  knowledge: { label: "panel-knowledge", title: "Knowledge", width: 720, height: 540, minWidth: 620, minHeight: 440 },
  settings: { label: "panel-settings", title: "Settings", width: 460, height: 560, minWidth: 400, minHeight: 460 },
};

function panelFromLocation(): AuxPanel | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("panel");
  return value && value in AUX_PANEL_CONFIG ? (value as AuxPanel) : null;
}

function panelTitle(panel: AuxPanel, language: InterfaceLanguage) {
  if (panel === "chats") return uiText(language, "chats");
  if (panel === "projects") return uiText(language, "projects");
  if (panel === "tasks") return uiText(language, "tasks");
  if (panel === "terminal") return uiText(language, "terminal");
  if (panel === "search") return uiText(language, "search");
  if (panel === "memory") return uiText(language, "memory");
  if (panel === "knowledge") return uiText(language, "knowledge");
  return uiText(language, "settings");
}

function loadSidebarProfile(): SidebarProfile {
  if (typeof window === "undefined") return { name: "ino-agent", avatarDataUrl: "" };
  try {
    const raw = window.localStorage.getItem(SIDEBAR_PROFILE_STORAGE_KEY);
    if (!raw) return { name: "ino-agent", avatarDataUrl: "" };
    const parsed = JSON.parse(raw) as Partial<SidebarProfile>;
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : "ino-agent",
      avatarDataUrl: typeof parsed.avatarDataUrl === "string" ? parsed.avatarDataUrl : "",
    };
  } catch {
    return { name: "ino-agent", avatarDataUrl: "" };
  }
}

function saveSidebarProfile(profile: SidebarProfile) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDEBAR_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Local UI preference only; ignore storage failures.
  }
}

function squareCropImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Could not load image."));
      image.onload = () => {
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        const sourceX = Math.max(0, (image.naturalWidth - side) / 2);
        const sourceY = Math.max(0, (image.naturalHeight - side) / 2);
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Could not crop image."));
          return;
        }
        context.drawImage(image, sourceX, sourceY, side, side, 0, 0, 256, 256);
        resolve(canvas.toDataURL("image/png"));
      };
      image.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
  });
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
  const auxPanel = panelFromLocation();
  if (auxPanel) {
    return <PanelWindowApp panel={auxPanel} />;
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
  const [settingsDraft, setSettingsDraft] = useState<ChatSettings>(DEFAULT_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState("");
  const [treeVisible, setTreeVisible] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatHomeVisible, setChatHomeVisible] = useState(true);
  const [startingChat, setStartingChat] = useState(false);
  const [windowFullscreen, setWindowFullscreen] = useState(false);
  const [dialog, setDialog] = useState<AppDialogState | null>(null);
  const [activeAuxPanel, setActiveAuxPanel] = useState<AuxPanel | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
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
  const titlebarNeedsTrafficSpace = isTauriRuntime() && !windowFullscreen;
  const titlebarTitle = chatHomeVisible ? "ino-agent" : selectedNode?.title ?? activeTree?.title ?? "ino-agent";
  const titlebarSubtitle =
    !chatHomeVisible && selectedNode && selectedNode.treeTitle !== selectedNode.title
      ? selectedNode.treeTitle
      : "";
  const language = settings.language ?? DEFAULT_SETTINGS.language;

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
      setActiveAuxPanel(null);
      setChatHomeVisible(false);
      setTreeVisible(false);
      await loadCanvas(created.root_node_id, created.tree_id);
    } catch (e) {
      setStatusText(String(e));
    }
  }, [askText, loadCanvas]);

  const handleNewChat = useCallback(() => {
    setActiveAuxPanel(null);
    setChatHomeVisible(true);
    setTreeVisible(false);
    setTargetMessageId("");
    setChatError("");
    setMessages([]);
  }, []);

  const handleSelectTree = useCallback(
    async (treeId: string) => {
      const tree = trees.find((item) => item.id === treeId);
      activeTreeIdRef.current = treeId;
      setActiveTreeId(treeId);
      setActiveAuxPanel(null);
      setChatHomeVisible(false);
      setTreeVisible(false);
      await loadCanvas(tree?.last_node_id ?? null, treeId);
    },
    [loadCanvas, trees],
  );

  const closeEmbeddedPanel = useCallback(() => {
    setActiveAuxPanel(null);
  }, []);

  const openEmbeddedPanel = useCallback((panel: AuxPanel) => {
    setActiveAuxPanel(panel);
    setTreeVisible(false);
    setChatHomeVisible(false);
  }, []);

  const handleRenameTreeFromSidebar = useCallback(
    async (tree: TreeSummary) => {
      const title = await askText({
        title: uiText(language, "renameChat"),
        label: uiText(language, "renameChat"),
        value: tree.title,
        placeholder: tree.title,
        confirmText: uiText(language, "save"),
      });
      if (title === null) return;
      const nextTitle = title.trim();
      if (!nextTitle || nextTitle === tree.title) return;

      try {
        await api.renameTree(tree.id, nextTitle);
        await loadCanvas(
          tree.id === activeTreeIdRef.current ? selectedNodeIdRef.current : null,
          activeTreeIdRef.current,
        );
      } catch (e) {
        setStatusText(String(e));
      }
    },
    [askText, language, loadCanvas],
  );

  const handleDeleteTreeFromSidebar = useCallback(
    async (tree: TreeSummary) => {
      const confirmed = await askConfirm({
        title: uiText(language, "deleteChat"),
        message: `${uiText(language, "deleteChatConfirm")} "${tree.title}"?`,
        confirmText: uiText(language, "delete"),
        destructive: true,
      });
      if (!confirmed) return;

      try {
        const deletingActive = tree.id === activeTreeIdRef.current;
        await api.deleteTree(tree.id);
        const remainingCount = trees.filter((item) => item.id !== tree.id).length;
        if (deletingActive) {
          activeTreeIdRef.current = null;
          selectedNodeIdRef.current = null;
          setMessages([]);
          setTargetMessageId("");
          setChatHomeVisible(remainingCount === 0);
          if (remainingCount === 0) {
            setTreeVisible(false);
          }
        }
        await loadCanvas(null, deletingActive ? null : activeTreeIdRef.current);
      } catch (e) {
        setStatusText(String(e));
      }
    },
    [askConfirm, language, loadCanvas, trees],
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
      setActiveAuxPanel(null);
      setTreeVisible(false);
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
          setActiveAuxPanel(null);
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
      const created = await api.createTree(titleFromPrompt(content, language));
      await api.setCurrentNode(created.tree_id, created.root_node_id);
      setChatHomeVisible(false);
      await loadCanvas(created.root_node_id, created.tree_id);
      return created;
    },
    [language, loadCanvas],
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
      setActiveAuxPanel(null);
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

  const loadConnectors = useCallback(async () => {
    setConnectorsLoading(true);
    try {
      setConnectors(await api.listConnectors());
      setStatusText("");
    } catch (e) {
      setStatusText(String(e));
    } finally {
      setConnectorsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeAuxPanel === "settings") {
      void loadConnectors();
    }
  }, [activeAuxPanel, loadConnectors]);

  const saveSettings = useCallback(async (input: SettingsInput) => {
    const saved = await api.saveSettings(input);
    setSettings(saved);
    setSettingsDraft(saved);
    await emit("panel-settings-saved");
  }, []);

  const handleSubmitSettings = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setSavingSettings(true);
      try {
        await saveSettings(settingsDraft);
        setStatusText("");
      } catch (e) {
        setStatusText(String(e));
      } finally {
        setSavingSettings(false);
      }
    },
    [saveSettings, settingsDraft],
  );

  const handleThemeChange = useCallback(
    (theme: ThemeName) => {
      const next = { ...settingsDraft, theme };
      setSettingsDraft(next);
      void saveSettings(next).catch((e) => setStatusText(String(e)));
    },
    [saveSettings, settingsDraft],
  );

  const handleLanguageChange = useCallback(
    (language: InterfaceLanguage) => {
      const next = { ...settingsDraft, language };
      setSettingsDraft(next);
      void saveSettings(next).catch((e) => setStatusText(String(e)));
    },
    [saveSettings, settingsDraft],
  );

  const handleToggleConnector = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await api.setConnectorEnabled(id, enabled);
        await loadConnectors();
        await emit("panel-settings-saved");
      } catch (e) {
        setStatusText(String(e));
      }
    },
    [loadConnectors],
  );

  const handleOpenFolder = useCallback(async (path: string) => {
    try {
      await openShell(path);
    } catch (e) {
      setStatusText(String(e));
    }
  }, []);

  const handleAskAgentFromPanel = useCallback(
    async (content: string) => {
      setActiveAuxPanel(null);
      setTreeVisible(false);
      setChatHomeVisible(true);
      await handleStartChat(content);
    },
    [handleStartChat],
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisteners: Array<() => void> = [];
    void listen<PanelSelectTreeEvent>("panel-select-tree", (event) => {
      if (event.payload.treeId) {
        void handleSelectTree(event.payload.treeId);
      }
    }).then((fn) => unlisteners.push(fn));
    void listen<PanelOpenTargetEvent>("panel-open-target", (event) => {
      if (event.payload.target) {
        void handleOpenTarget(event.payload.target);
      }
    }).then((fn) => unlisteners.push(fn));
    void listen<PanelStartChatEvent>("panel-start-chat", (event) => {
      if (event.payload.content) {
        void handleStartChat(event.payload.content);
      }
    }).then((fn) => unlisteners.push(fn));
    void listen("panel-settings-saved", () => {
      void api.getSettings().then((next) => {
        setSettings(next);
      });
    }).then((fn) => unlisteners.push(fn));
    return () => {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [handleOpenTarget, handleSelectTree, handleStartChat]);

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
        setActiveAuxPanel("settings");
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
    [createInitialTree, loadCanvas],
  );

  const handleConfirmBranches = useCallback(
    async (message: Message, titles?: string[]) => {
      const nodeId = message.node_id;
      const treeId = message.tree_id;
      if (activeRequestsRef.current[nodeId]) return;

      setActiveRequests((current) => ({ ...current, [nodeId]: "confirm-branches" }));
      setAgentToolEvents((current) => ({ ...current, [nodeId]: [] }));
      setChatError("");
      try {
        const reply = await api.confirmPendingBranches(treeId, nodeId, titles);
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
        setActiveAuxPanel("settings");
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
    [selectedNode],
  );

  const embeddedPanelNode =
    activeAuxPanel === "chats" ? (
      <ChatsPanel
        windowed
        trees={trees}
        activeTreeId={activeTreeId}
        language={language}
        onCreateRoot={handleCreateRoot}
        onSelectTree={handleSelectTree}
      />
    ) : activeAuxPanel === "projects" ? (
      <ProjectWizardPanel
        windowed
        onClose={closeEmbeddedPanel}
        onOpenFolder={handleOpenFolder}
        onAskAgent={handleAskAgentFromPanel}
      />
    ) : activeAuxPanel === "tasks" ? (
      <AgentTasksPanel
        windowed
        treeId={selectedTreeId}
        nodeId={selectedCanvasNodeId}
        onClose={closeEmbeddedPanel}
      />
    ) : activeAuxPanel === "terminal" ? (
      <TerminalPanel windowed onClose={closeEmbeddedPanel} />
    ) : activeAuxPanel === "search" ? (
      <SearchPanel windowed onClose={closeEmbeddedPanel} onOpenTarget={handleOpenTarget} />
    ) : activeAuxPanel === "memory" ? (
      <MemoryPanel windowed onClose={closeEmbeddedPanel} onOpenTarget={handleOpenTarget} />
    ) : activeAuxPanel === "knowledge" ? (
      <KnowledgePanel windowed onClose={closeEmbeddedPanel} onOpenTarget={handleOpenTarget} />
    ) : activeAuxPanel === "settings" ? (
      <SettingsPanel
        windowed
        settings={settings}
        settingsDraft={settingsDraft}
        saving={savingSettings}
        connectors={connectors}
        connectorsLoading={connectorsLoading}
        onChange={setSettingsDraft}
        onThemeChange={handleThemeChange}
        onLanguageChange={handleLanguageChange}
        onToggleConnector={handleToggleConnector}
        onCancel={closeEmbeddedPanel}
        onSubmit={handleSubmitSettings}
      />
    ) : null;

  return (
    <main className="no-drag relative flex h-screen overflow-hidden bg-[color:var(--app-bg)] text-[color:var(--text)]">
      <div className="drag-region absolute left-0 right-0 top-0 z-20 h-2" />
      {sidebarOpen && (
        <MainSidebar
          trees={trees}
          activeTreeId={activeAuxPanel || chatHomeVisible ? null : activeTreeId}
          activePanel={activeAuxPanel}
          language={language}
          onNewChat={handleNewChat}
          onSelectTree={handleSelectTree}
          onDeleteTree={handleDeleteTreeFromSidebar}
          onRenameTree={handleRenameTreeFromSidebar}
          onOpenPanel={openEmbeddedPanel}
          onOpenSearch={() => openEmbeddedPanel("search")}
          onOpenSettings={() => openEmbeddedPanel("settings")}
          onCloseSidebar={() => setSidebarOpen(false)}
          compactTopInset={!titlebarNeedsTrafficSpace}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header
          className={`no-drag relative z-40 flex h-12 shrink-0 items-center bg-[color:var(--app-bg)] px-3 ${
            chatHomeVisible ? "" : "border-b border-[color:var(--border)]"
          }`}
        >
          <div
            className={`absolute left-3 top-2 flex min-w-0 items-center justify-start gap-2 md:hidden ${
              titlebarNeedsTrafficSpace ? "pl-0 sm:pl-[72px]" : "pl-0"
            }`}
          >
            {titlebarNeedsTrafficSpace && (
              <div className="drag-region mr-1 hidden h-8 w-2 shrink-0 sm:flex" />
            )}
            <TopBarButton
              label={uiText(language, "chats")}
              active={activeAuxPanel === "chats"}
              onClick={() => openEmbeddedPanel("chats")}
            >
              <ChatsIcon />
            </TopBarButton>
            <TopBarButton
              label={uiText(language, "search")}
              active={activeAuxPanel === "search"}
              onClick={() => openEmbeddedPanel("search")}
            >
              <SearchIcon />
            </TopBarButton>
          </div>
          {!sidebarOpen && (
            <div
              className={`absolute left-3 top-2 hidden min-w-0 items-center justify-start gap-2 md:flex ${
                titlebarNeedsTrafficSpace ? "pl-[72px]" : "pl-0"
              }`}
            >
              <TopBarButton
                label={uiText(language, "search")}
                active={activeAuxPanel === "search"}
                onClick={() => openEmbeddedPanel("search")}
              >
                <SearchIcon />
              </TopBarButton>
              <TopBarButton
                label={uiText(language, "openSidebar")}
                onClick={() => setSidebarOpen(true)}
              >
                <SidebarToggleIcon />
              </TopBarButton>
            </div>
          )}
          {(!chatHomeVisible || activeAuxPanel) && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 flex max-w-[min(560px,42vw)] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center leading-tight">
              <div className="max-w-full truncate text-sm font-semibold text-[color:var(--text)]">
                {activeAuxPanel ? panelTitle(activeAuxPanel, language) : titlebarTitle}
              </div>
              {!activeAuxPanel && titlebarSubtitle && (
                <div className="mt-0.5 max-w-full truncate text-[11px] text-[color:var(--muted)]">
                  {titlebarSubtitle}
                </div>
              )}
            </div>
          )}
          <div className="absolute right-3 top-2 flex min-w-0 items-center justify-end gap-2">
            {!chatHomeVisible && !activeAuxPanel && (
              <TopBarButton
                label={treeVisible ? uiText(language, "focus") : uiText(language, "tree")}
                onClick={() => {
                  setActiveAuxPanel(null);
                  setTreeVisible((value) => {
                    const nextVisible = !value;
                    if (nextVisible) {
                      setChatHomeVisible(false);
                    }
                    return nextVisible;
                  });
                }}
              >
                <TreeGraphIcon />
              </TopBarButton>
            )}
            <div className="md:hidden">
              <TopBarButton
                label={uiText(language, "settings")}
                active={activeAuxPanel === "settings"}
                tooltipAlign="right"
                onClick={() => openEmbeddedPanel("settings")}
              >
                <SettingsIcon />
              </TopBarButton>
            </div>
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
            {embeddedPanelNode}
            {!embeddedPanelNode && treeVisible && (
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
            {!embeddedPanelNode && !treeVisible && (
              <ChatPanel
                selectedNode={chatHomeVisible ? null : selectedNode}
                messages={chatHomeVisible ? [] : messages}
                loading={chatHomeVisible ? false : messagesLoading}
                sending={startingChat || (!chatHomeVisible && selectedNodeIsSending)}
                streamingText={chatHomeVisible ? "" : selectedStreamingText}
                agentToolEvents={chatHomeVisible ? [] : selectedAgentToolEvents}
                canWrite={Boolean(!chatHomeVisible && selectedNode?.is_leaf)}
                canStartChat={chatHomeVisible}
                fullWidth
                error={chatError}
                targetMessageId={targetMessageId}
                language={language}
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
            )}
          </Suspense>
        </div>
      </div>
      {onboardingOpen && (
        <OnboardingPanel
          language={language}
          onClose={dismissOnboarding}
          onOpenSettings={() => {
            dismissOnboarding();
            openEmbeddedPanel("settings");
          }}
          onOpenProjects={() => {
            dismissOnboarding();
            openEmbeddedPanel("projects");
          }}
        />
      )}
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
    </main>
  );
}

function PanelWindowApp({ panel }: { panel: AuxPanel }) {
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<ChatSettings>(DEFAULT_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [trees, setTrees] = useState<TreeSummary[]>([]);
  const [statusText, setStatusText] = useState("");

  const searchParams = useMemo(
    () => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)),
    [],
  );
  const activeTreeId = searchParams.get("treeId");
  const activeNodeId = searchParams.get("nodeId");

  const closeWindow = useCallback(async () => {
    if (!isTauriRuntime()) return;
    await getCurrentWindow().close();
  }, []);

  const focusMainWindow = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const mainWindow = await WebviewWindow.getByLabel("main");
    await mainWindow?.show();
    await mainWindow?.setFocus();
  }, []);

  const loadTrees = useCallback(async () => {
    try {
      setTrees(await api.listTrees());
      setStatusText("");
    } catch (e) {
      setStatusText(String(e));
    }
  }, []);

  const loadConnectors = useCallback(async () => {
    setConnectorsLoading(true);
    try {
      setConnectors(await api.listConnectors());
      setStatusText("");
    } catch (e) {
      setStatusText(String(e));
    } finally {
      setConnectorsLoading(false);
    }
  }, []);

  useEffect(() => {
    void api
      .getSettings()
      .then((loaded) => {
        setSettings(loaded);
        setSettingsDraft(loaded);
      })
      .catch((e) => setStatusText(String(e)));
  }, []);

  useEffect(() => {
    applyThemeVars(THEMES[settings.theme] ?? THEMES[DEFAULT_SETTINGS.theme]);
  }, [settings.theme]);

  useEffect(() => {
    if (panel === "chats") {
      void loadTrees();
    }
    if (panel === "settings") {
      void loadConnectors();
    }
  }, [loadConnectors, loadTrees, panel]);

  const saveSettings = useCallback(
    async (input: SettingsInput) => {
      const saved = await api.saveSettings(input);
      setSettings(saved);
      setSettingsDraft(saved);
      await emit("panel-settings-saved");
    },
    [],
  );

  const handleSubmitSettings = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setSavingSettings(true);
      try {
        await saveSettings(settingsDraft);
        setStatusText("");
      } catch (e) {
        setStatusText(String(e));
      } finally {
        setSavingSettings(false);
      }
    },
    [saveSettings, settingsDraft],
  );

  const handleThemeChange = useCallback(
    (theme: ThemeName) => {
      const next = { ...settingsDraft, theme };
      setSettingsDraft(next);
      void saveSettings(next).catch((e) => setStatusText(String(e)));
    },
    [saveSettings, settingsDraft],
  );

  const handleLanguageChange = useCallback(
    (language: InterfaceLanguage) => {
      const next = { ...settingsDraft, language };
      setSettingsDraft(next);
      void saveSettings(next).catch((e) => setStatusText(String(e)));
    },
    [saveSettings, settingsDraft],
  );

  const handleToggleConnector = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await api.setConnectorEnabled(id, enabled);
        await loadConnectors();
        await emit("panel-settings-saved");
      } catch (e) {
        setStatusText(String(e));
      }
    },
    [loadConnectors],
  );

  const handleCreateRoot = useCallback(async () => {
    try {
      const created = await api.createTree("Root");
      await api.setCurrentNode(created.tree_id, created.root_node_id);
      await emit<PanelSelectTreeEvent>("panel-select-tree", { treeId: created.tree_id });
      await focusMainWindow();
      await closeWindow();
    } catch (e) {
      setStatusText(String(e));
    }
  }, [closeWindow, focusMainWindow]);

  const handleSelectTree = useCallback(
    async (treeId: string) => {
      try {
        await emit<PanelSelectTreeEvent>("panel-select-tree", { treeId });
        await focusMainWindow();
        await closeWindow();
      } catch (e) {
        setStatusText(String(e));
      }
    },
    [closeWindow, focusMainWindow],
  );

  const handleOpenTarget = useCallback(
    async (target: string) => {
      const trimmed = target.trim();
      if (!trimmed) return;
      try {
        const resolved = await api.resolveTarget(trimmed);
        if (resolved.kind === "chat") {
          await emit<PanelOpenTargetEvent>("panel-open-target", { target: trimmed });
          await focusMainWindow();
          await closeWindow();
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
    [closeWindow, focusMainWindow],
  );

  const handleOpenFolder = useCallback(async (path: string) => {
    try {
      await openShell(path);
    } catch (e) {
      setStatusText(String(e));
    }
  }, []);

  const handleAskAgent = useCallback(
    async (content: string) => {
      try {
        await emit<PanelStartChatEvent>("panel-start-chat", { content });
        await focusMainWindow();
        await closeWindow();
      } catch (e) {
        setStatusText(String(e));
      }
    },
    [closeWindow, focusMainWindow],
  );

  const panelNode =
    panel === "chats" ? (
      <ChatsPanel
        windowed
        trees={trees}
        activeTreeId={activeTreeId}
        language={settings.language}
        onCreateRoot={handleCreateRoot}
        onSelectTree={handleSelectTree}
      />
    ) : panel === "projects" ? (
      <ProjectWizardPanel
        windowed
        onClose={() => void closeWindow()}
        onOpenFolder={handleOpenFolder}
        onAskAgent={handleAskAgent}
      />
    ) : panel === "tasks" ? (
      <AgentTasksPanel
        windowed
        treeId={activeTreeId}
        nodeId={activeNodeId}
        onClose={() => void closeWindow()}
      />
    ) : panel === "terminal" ? (
      <TerminalPanel windowed onClose={() => void closeWindow()} />
    ) : panel === "search" ? (
      <SearchPanel windowed onClose={() => void closeWindow()} onOpenTarget={handleOpenTarget} />
    ) : panel === "memory" ? (
      <MemoryPanel windowed onClose={() => void closeWindow()} onOpenTarget={handleOpenTarget} />
    ) : panel === "knowledge" ? (
      <KnowledgePanel windowed onClose={() => void closeWindow()} onOpenTarget={handleOpenTarget} />
    ) : (
      <SettingsPanel
        windowed
        settings={settings}
        settingsDraft={settingsDraft}
        saving={savingSettings}
        connectors={connectors}
        connectorsLoading={connectorsLoading}
        onChange={setSettingsDraft}
        onThemeChange={handleThemeChange}
        onLanguageChange={handleLanguageChange}
        onToggleConnector={handleToggleConnector}
        onCancel={() => void closeWindow()}
        onSubmit={handleSubmitSettings}
      />
    );

  return (
    <main className="no-drag h-screen overflow-hidden bg-[color:var(--panel)] text-[color:var(--text)]">
      {panelNode}
      {statusText && (
        <div className="fixed bottom-3 left-3 right-3 z-[100] rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 shadow-[0_8px_28px_rgba(0,0,0,0.14)]">
          {statusText}
        </div>
      )}
    </main>
  );
}

function OnboardingPanel({
  language,
  onClose,
  onOpenSettings,
  onOpenProjects,
}: {
  language: InterfaceLanguage;
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
            {uiText(language, "onboardingDescription")}
          </div>
        </div>
        <div className="grid gap-2 p-4">
          <OnboardingStep
            label="1"
            title={uiText(language, "onboardingSetAccessTitle")}
            text={uiText(language, "onboardingSetAccessText")}
          />
          <OnboardingStep
            label="2"
            title={uiText(language, "onboardingWorkTitle")}
            text={uiText(language, "onboardingWorkText")}
          />
          <OnboardingStep
            label="3"
            title={uiText(language, "onboardingPrivacyTitle")}
            text={uiText(language, "onboardingPrivacyText")}
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
      className={`group relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)] focus-visible:bg-[color:var(--selected)] focus-visible:text-[color:var(--text)] focus-visible:outline-none ${
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

function MainSidebar({
  trees,
  activeTreeId,
  activePanel,
  language,
  onNewChat,
  onSelectTree,
  onDeleteTree,
  onRenameTree,
  onOpenPanel,
  onOpenSearch,
  onOpenSettings,
  onCloseSidebar,
  compactTopInset,
}: {
  trees: TreeSummary[];
  activeTreeId: string | null;
  activePanel: AuxPanel | null;
  language: InterfaceLanguage;
  onNewChat: () => void;
  onSelectTree: (treeId: string) => void;
  onDeleteTree: (tree: TreeSummary) => void;
  onRenameTree: (tree: TreeSummary) => void;
  onOpenPanel: (panel: AuxPanel) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onCloseSidebar: () => void;
  compactTopInset: boolean;
}) {
  const orderedTrees = [...trees].sort((a, b) => b.updated_at - a.updated_at);
  const toolItems: Array<{ panel: AuxPanel; label: string; icon: ReactNode }> = [
    { panel: "projects", label: uiText(language, "projects"), icon: <ProjectIcon /> },
    { panel: "tasks", label: uiText(language, "tasks"), icon: <TasksIcon /> },
    { panel: "terminal", label: uiText(language, "terminal"), icon: <TerminalIcon /> },
    { panel: "memory", label: uiText(language, "memory"), icon: <MemoryIcon /> },
    { panel: "knowledge", label: uiText(language, "knowledge"), icon: <KnowledgeIcon /> },
  ];
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const profileRootRef = useRef<HTMLDivElement | null>(null);
  const [profile, setProfile] = useState<SidebarProfile>(() => loadSidebarProfile());
  const [profileOpen, setProfileOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    tree: TreeSummary;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!profileOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && profileRootRef.current?.contains(target)) return;
      setProfileOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileOpen]);

  const updateProfile = useCallback((next: SidebarProfile) => {
    setProfile(next);
    saveSidebarProfile(next);
  }, []);

  const handleAvatarFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const avatarDataUrl = await squareCropImageFile(file);
        updateProfile({ ...profile, avatarDataUrl });
      } catch {
        // Ignore invalid images; the input stays available for another attempt.
      }
    },
    [profile, updateProfile],
  );

  const initials = profile.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "IA";

  return (
    <aside className="no-drag hidden h-screen w-[260px] shrink-0 flex-col border-r border-[color:var(--border)] bg-[color:var(--sidebar)] text-[color:var(--text)] md:flex">
      <div className={`drag-region shrink-0 ${compactTopInset ? "h-0" : "h-10"}`} />
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        <div className="truncate text-[23px] font-semibold tracking-normal">ino-agent</div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label={uiText(language, "search")}
            title={uiText(language, "search")}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)] focus-visible:bg-[color:var(--selected)] focus-visible:outline-none"
          >
            <SearchIcon />
          </button>
          <button
            type="button"
            onClick={onCloseSidebar}
            aria-label={uiText(language, "closeSidebar")}
            title={uiText(language, "closeSidebar")}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)] focus-visible:bg-[color:var(--selected)] focus-visible:outline-none"
          >
            <SidebarToggleIcon />
          </button>
        </div>
      </div>
      <nav className="shrink-0 space-y-1 px-3 py-2">
        <button
          type="button"
          onClick={onNewChat}
          className="flex h-9 w-full items-center gap-2 rounded-2xl px-3 text-left text-[13px] font-medium text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)] focus-visible:bg-[color:var(--selected)] focus-visible:outline-none"
        >
          <NewChatIcon />
          <span className="truncate">{uiText(language, "newChat")}</span>
        </button>
        {toolItems.map((item) => {
          const active = activePanel === item.panel;
          return (
            <button
              key={item.panel}
              type="button"
              onClick={() => onOpenPanel(item.panel)}
              className={`flex h-9 w-full items-center gap-2 rounded-2xl px-3 text-left text-[13px] font-medium transition-colors focus-visible:outline-none ${
                active
                  ? "bg-[color:var(--selected)] text-[color:var(--text)]"
                  : "text-[color:var(--text)] hover:bg-[color:var(--selected)] focus-visible:bg-[color:var(--selected)]"
              }`}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-2 px-3 text-[13px] font-semibold text-[color:var(--text)]">
          {uiText(language, "recent")}
        </div>
        {orderedTrees.length === 0 ? (
          <div className="px-3 py-2 text-[13px] text-[color:var(--muted)]">{uiText(language, "noChats")}</div>
        ) : (
          <div className="space-y-0.5">
            {orderedTrees.map((tree) => {
              const active = tree.id === activeTreeId;
              return (
                <div
                  key={tree.id}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({
                      tree,
                      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 220)),
                      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 96)),
                    });
                  }}
                  className={`group flex h-9 w-full min-w-0 items-center gap-2 rounded-2xl pl-3 pr-1.5 text-left text-[13px] transition-colors focus-visible:outline-none ${
                    active
                      ? "bg-[color:var(--selected)] text-[color:var(--text)]"
                      : "text-[color:var(--text)] hover:bg-[color:var(--selected)] focus-visible:bg-[color:var(--selected)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectTree(tree.id)}
                    className="min-w-0 flex-1 truncate text-left outline-none"
                  >
                    {tree.title}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {contextMenu && (
        <div
          className="fixed z-[120] min-w-[188px] rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] p-1.5 text-[color:var(--text)] shadow-[0_12px_30px_rgba(0,0,0,0.18)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              const tree = contextMenu.tree;
              setContextMenu(null);
              onRenameTree(tree);
            }}
            className="flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-left text-sm text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)] focus-visible:bg-[color:var(--selected)] focus-visible:outline-none"
          >
            <RenameIcon />
            <span className="truncate">{uiText(language, "renameChat")}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const tree = contextMenu.tree;
              setContextMenu(null);
              onDeleteTree(tree);
            }}
            className="flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-left text-sm text-[#d93025] transition-colors hover:bg-[color:var(--selected)] focus-visible:bg-[color:var(--selected)] focus-visible:outline-none"
          >
            <TrashIcon />
            <span className="truncate">{uiText(language, "deleteChat")}</span>
          </button>
        </div>
      )}
      <div
        ref={profileRootRef}
        className="relative shrink-0 border-t border-[color:var(--border)] p-2.5"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setProfileOpen((open) => !open)}
            aria-expanded={profileOpen}
            className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-2.5 text-left transition-colors hover:bg-[color:var(--selected)] focus-visible:bg-[color:var(--selected)] focus-visible:outline-none"
          >
            {profile.avatarDataUrl ? (
              <img
                src={profile.avatarDataUrl}
                alt=""
                className="h-7 w-7 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#10a37f] text-[11px] font-semibold text-white">
                {initials}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-[color:var(--text)]">
                {profile.name}
              </span>
              <span className="block truncate text-[11px] text-[color:var(--muted)]">
                {uiText(language, "profile")}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={uiText(language, "settings")}
            title={uiText(language, "settings")}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)] focus-visible:bg-[color:var(--selected)] focus-visible:outline-none"
          >
            <SettingsIcon />
          </button>
        </div>
        {profileOpen && (
          <div
            className="absolute bottom-[62px] left-2.5 right-2.5 z-[120] rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] p-3 text-[color:var(--text)] shadow-[0_12px_30px_rgba(0,0,0,0.18)]"
          >
            <div className="mb-3 text-sm font-semibold">{uiText(language, "profile")}</div>
            <div className="flex items-center gap-3">
              {profile.avatarDataUrl ? (
                <img
                  src={profile.avatarDataUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#10a37f] text-sm font-semibold text-white">
                  {initials}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="h-7 rounded-full bg-[color:var(--panel-soft)] px-3 text-xs font-medium transition-colors hover:bg-[color:var(--selected)] focus-visible:bg-[color:var(--selected)] focus-visible:outline-none"
                >
                  {uiText(language, "chooseAvatar")}
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    void handleAvatarFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </div>
            </div>
            <label className="mt-3 block text-xs text-[color:var(--muted)]">
              {uiText(language, "displayName")}
              <input
                type="text"
                value={profile.name}
                onChange={(event) => {
                  const name = event.target.value;
                  updateProfile({ ...profile, name });
                }}
                onBlur={() => {
                  if (!profile.name.trim()) {
                    updateProfile({ ...profile, name: "ino-agent" });
                  }
                }}
                className="mt-1 h-8 w-full rounded-2xl border border-transparent bg-[color:var(--panel-soft)] px-3 text-sm text-[color:var(--text)] outline-none focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)]"
              />
            </label>
          </div>
        )}
      </div>
    </aside>
  );
}

function titleFromPrompt(content: string, language: InterfaceLanguage) {
  const firstLine =
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(
        (line) =>
          line &&
          !line.startsWith("[Attached file:") &&
          !line.startsWith("Note:") &&
          !line.startsWith("```"),
      ) ?? uiText(language, "newChat");
  const normalized = firstLine.replace(/\s+/g, " ");
  return normalized.length > 56 ? `${normalized.slice(0, 53).trim()}...` : normalized;
}

function ChatsPanel({
  trees,
  activeTreeId,
  language,
  onCreateRoot,
  onSelectTree,
  windowed = false,
}: {
  trees: TreeSummary[];
  activeTreeId: string | null;
  language: InterfaceLanguage;
  onCreateRoot: () => void;
  onSelectTree: (treeId: string) => void;
  windowed?: boolean;
}) {
  const orderedTrees = [...trees].sort((a, b) => b.updated_at - a.updated_at);

  return (
    <div
      className={
        windowed
          ? "no-drag flex h-full min-h-0 flex-col overflow-hidden bg-[color:var(--panel)]"
          : "no-drag fixed left-3 right-3 top-12 z-50 max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] shadow-[0_12px_40px_rgba(0,0,0,0.14)] sm:absolute sm:left-0 sm:right-auto sm:top-10 sm:w-[300px]"
      }
    >
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[color:var(--text)]">
            {uiText(language, "chats")}
          </div>
          <div className="truncate text-[11px] text-[color:var(--muted)]">
            {uiText(language, "latestFirst")}
          </div>
        </div>
        <button
          type="button"
          onClick={onCreateRoot}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[color:var(--border)] text-[color:var(--text)] transition-colors hover:bg-[color:var(--selected)]"
          aria-label={uiText(language, "newChat")}
          title={uiText(language, "newChat")}
        >
          <PlusIcon />
        </button>
      </div>
      <div className={`${windowed ? "min-h-0 flex-1" : "max-h-[360px]"} overflow-y-auto p-1.5`}>
        {orderedTrees.length === 0 ? (
          <div className="px-3 py-3 text-sm text-[color:var(--muted)]">
            {uiText(language, "noChats")}
          </div>
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
                    {tree.message_count} {uiText(language, "messages")}
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
  onLanguageChange,
  onToggleConnector,
  onCancel,
  onSubmit,
  windowed = false,
}: {
  settings: ChatSettings;
  settingsDraft: ChatSettings;
  saving: boolean;
  connectors: ConnectorSummary[];
  connectorsLoading: boolean;
  onChange: (next: ChatSettings) => void;
  onThemeChange: (theme: ThemeName) => void;
  onLanguageChange: (language: InterfaceLanguage) => void;
  onToggleConnector: (id: string, enabled: boolean) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
  windowed?: boolean;
}) {
  const language = settingsDraft.language ?? settings.language ?? DEFAULT_SETTINGS.language;
  const inputClass =
    "mt-1 h-9 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 text-sm text-[color:var(--text)] outline-none transition-shadow placeholder:text-[color:var(--muted)] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.035)]";
  const textareaClass =
    "mt-1 min-h-24 w-full resize-y rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-2 text-sm leading-5 text-[color:var(--text)] outline-none transition-shadow placeholder:text-[color:var(--muted)] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.035)]";
  return (
    <form
      onSubmit={onSubmit}
      className={
        windowed
          ? "no-drag h-full w-full min-h-0 flex-1 overflow-y-auto bg-[color:var(--panel)] p-6"
          : "no-drag fixed left-3 right-3 top-12 z-50 max-w-[calc(100vw-24px)] rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] p-3 shadow-[0_12px_40px_rgba(0,0,0,0.14)] sm:absolute sm:left-auto sm:right-0 sm:top-10 sm:w-[420px]"
      }
    >
      <div className="mx-auto w-full max-w-[560px]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-[color:var(--text)]">
            {uiText(language, "agentSettings")}
          </div>
          <div className="text-xs text-[color:var(--muted)]">
            {uiText(language, "appearanceModelApi")}
          </div>
        </div>
        <div className="rounded-full border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]">
          {settings.api_key ? uiText(language, "apiConnected") : uiText(language, "noApiKey")}
        </div>
      </div>
      <div className="grid gap-2">
        <label className="block text-xs text-[color:var(--muted)]">
          {uiText(language, "theme")}
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
          {uiText(language, "language")}
          <select
            value={language}
            onChange={(event) => onLanguageChange(event.target.value as InterfaceLanguage)}
            className={inputClass}
          >
            {INTERFACE_LANGUAGES.map((languageName) => (
              <option key={languageName} value={languageName}>
                {LANGUAGE_LABELS[languageName]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-[color:var(--muted)]">
          {uiText(language, "model")}
          <input
            type="text"
            value={settingsDraft.model}
            onChange={(event) => onChange({ ...settingsDraft, model: event.target.value })}
            className={inputClass}
            placeholder={DEFAULT_SETTINGS.model}
          />
        </label>
        <label className="block text-xs text-[color:var(--muted)]">
          {uiText(language, "apiKey")}
          <input
            type="password"
            value={settingsDraft.api_key}
            onChange={(event) => onChange({ ...settingsDraft, api_key: event.target.value })}
            className={inputClass}
            placeholder="sk-..."
          />
        </label>
        <label className="block text-xs text-[color:var(--muted)]">
          {uiText(language, "endpoint")}
          <input
            type="text"
            value={settingsDraft.endpoint}
            onChange={(event) => onChange({ ...settingsDraft, endpoint: event.target.value })}
            className={inputClass}
            placeholder={DEFAULT_SETTINGS.endpoint}
          />
        </label>
        <label className="block text-xs text-[color:var(--muted)]">
          {uiText(language, "systemPrompt")}
          <textarea
            value={settingsDraft.system_prompt ?? ""}
            onChange={(event) =>
              onChange({ ...settingsDraft, system_prompt: event.target.value })
            }
            className={textareaClass}
            placeholder={uiText(language, "systemPromptPlaceholder")}
          />
        </label>
      </div>
      <div className="mt-4 border-t border-[color:var(--border)] pt-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-[color:var(--text)]">
              {uiText(language, "connectors")}
            </div>
            <div className="text-xs text-[color:var(--muted)]">
              {uiText(language, "connectorsDescription")}
            </div>
          </div>
          <div className="rounded-full border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]">
            {connectorsLoading ? uiText(language, "loading") : connectors.length}
          </div>
        </div>
        <div className="max-h-[240px] space-y-2 overflow-y-auto pr-1">
          {connectors.length === 0 ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--app-bg)] px-3 py-2 text-xs text-[color:var(--muted)]">
              {uiText(language, "noConnectorDrafts")}
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
                    {connector.manifest.enabled ? uiText(language, "disable") : uiText(language, "enable")}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {connector.pending && (
                    <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--muted)]">
                      {uiText(language, "pending")}
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
                      {uiText(language, "files")}
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
          {uiText(language, "cancel")}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="h-8 rounded-full bg-[color:var(--button)] px-3 text-xs font-medium text-[color:var(--button-text)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? uiText(language, "saving") : uiText(language, "save")}
        </button>
      </div>
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

function NewChatIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}

function RenameIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="m14 7 3 3" />
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

function SidebarToggleIcon() {
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

function TreeGraphIcon() {
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
      <path d="M12 6v4" />
      <path d="M12 10 7 15" />
      <path d="m12 10 5 5" />
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="6" cy="17" r="2.5" />
      <circle cx="18" cy="17" r="2.5" />
    </svg>
  );
}
