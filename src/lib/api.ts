import { invoke } from "@tauri-apps/api/core";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export interface TreeSummary {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  last_node_id: string | null;
  message_count: number;
}

export interface TreeCreated {
  tree_id: string;
  root_node_id: string;
}

export interface LayoutNode {
  id: string;
  parent_id: string | null;
  title: string;
  summary: string | null;
  x: number;
  y: number;
  selected: boolean;
  is_leaf: boolean;
}

export interface DeleteNodeResult {
  parent_id: string | null;
  deleted_ids: string[];
}

export interface Message {
  id: string;
  tree_id: string;
  node_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: number;
}

export interface ChatSettings {
  endpoint: string;
  model: string;
  api_key: string;
}

export interface AiBranchCreated {
  id: string;
  title: string;
}

export interface AssistantReplyResult {
  message: Message;
  selected_node_id: string;
  created_branches: AiBranchCreated[];
}

export interface AssistantDelta {
  request_id: string;
  tree_id: string;
  node_id: string;
  delta: string;
}

export type SettingsInput = ChatSettings;

const FALLBACK_SETTINGS: ChatSettings = {
  endpoint: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4.1-mini",
  api_key: "",
};

const DESKTOP_ONLY_ERROR = "Open the desktop app window to use this action.";

export function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

function invokeDesktop<T>(command: string, args?: Record<string, unknown>) {
  if (!isTauriRuntime()) {
    return Promise.reject(new Error(DESKTOP_ONLY_ERROR));
  }
  return invoke<T>(command, args);
}

export const api = {
  listTrees: () =>
    isTauriRuntime() ? invoke<TreeSummary[]>("list_trees") : Promise.resolve([]),
  createTree: (title?: string) => invokeDesktop<TreeCreated>("create_tree", { title }),
  deleteTree: (treeId: string) => invokeDesktop<void>("delete_tree", { treeId }),
  setCurrentNode: (treeId: string, nodeId: string) =>
    invokeDesktop<void>("set_current_node", { treeId, nodeId }),
  createChildNode: (treeId: string, parentId: string, title?: string) =>
    invokeDesktop<string>("create_child_node", { treeId, parentId, title }),
  renameNode: (treeId: string, nodeId: string, title: string) =>
    invokeDesktop<void>("rename_node", { treeId, nodeId, title }),
  deleteNode: (treeId: string, nodeId: string) =>
    invokeDesktop<DeleteNodeResult>("delete_node", { treeId, nodeId }),
  getTreeLayout: (treeId: string) =>
    isTauriRuntime() ? invoke<LayoutNode[]>("get_tree_layout", { treeId }) : Promise.resolve([]),
  getSettings: () =>
    isTauriRuntime() ? invoke<ChatSettings>("get_settings") : Promise.resolve(FALLBACK_SETTINGS),
  saveSettings: (input: SettingsInput) => invokeDesktop<ChatSettings>("save_settings", { input }),
  getMessages: (treeId: string, nodeId: string) =>
    invokeDesktop<Message[]>("get_messages", { treeId, nodeId }),
  addUserMessage: (treeId: string, nodeId: string, content: string) =>
    invokeDesktop<Message>("add_user_message", { treeId, nodeId, content }),
  generateAssistantReply: (treeId: string, nodeId: string, requestId: string) =>
    invokeDesktop<AssistantReplyResult>("generate_assistant_reply", { treeId, nodeId, requestId }),
};
