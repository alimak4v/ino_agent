import { invoke } from "@tauri-apps/api/core";
import type { InterfaceLanguage } from "./i18n";
import type { ThemeName } from "./theme";

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
  color: string | null;
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
  visualization_html: string | null;
  created_at: number;
}

export interface QuizAttempt {
  id: string;
  tree_id: string;
  node_id: string;
  message_id: string;
  quiz_id: string;
  quiz_type: string;
  answer_json: string;
  is_correct: boolean;
  score: number;
  max_score: number;
  explanation: string;
  created_at: number;
}

export interface ChatSettings {
  endpoint: string;
  model: string;
  api_key: string;
  theme: ThemeName;
  language: InterfaceLanguage;
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

export interface AgentToolResult {
  tool: string;
  ok: boolean;
  content: unknown;
  permissionProfile?: string;
}

export interface AgentToolEvent extends AgentToolResult {
  requestId: string;
  treeId: string;
  nodeId: string;
  permissionProfile: string;
}

export interface AgentTrace {
  permissionProfile?: string;
  toolResults: AgentToolResult[];
  verifier?: {
    revised: boolean;
    issues: string[];
  } | null;
  retrieval?: RetrievalTrace | null;
}

export interface RetrievalTrace {
  query: string;
  memoryResults: RetrievalMemoryTrace[];
  relatedMemory: RetrievalRelatedMemoryTrace[];
  knowledgeResults: RetrievalKnowledgeTrace[];
}

export interface RetrievalMemoryTrace {
  id: string;
  title: string;
  target: string;
  sourceType: string;
  score: number;
  vectorScore: number;
  keywordScore: number;
}

export interface RetrievalRelatedMemoryTrace {
  id: string;
  title: string;
  target: string;
  sourceType: string;
  label: string;
  weight: number;
}

export interface RetrievalKnowledgeTrace {
  chunkId: string;
  sourceId: string;
  title: string;
  target: string;
  sourceType: string;
  startOffset: number;
  endOffset: number;
  score: number;
  vectorScore: number;
  keywordScore: number;
}

export interface WatchedPath {
  path: string;
}

export interface ConnectorManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  entry: string;
  permissions: string[];
  schedule: string | null;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

export interface ConnectorFile {
  path: string;
  content: string;
}

export interface ConnectorSummary {
  manifest: ConnectorManifest;
  path: string;
  pending: boolean;
  files: ConnectorFile[];
}

export type CodeLanguage = "python" | "javascript" | "cpp";

export interface RunCodeRequest {
  language: CodeLanguage;
  code: string;
  stdin?: string;
  dependencies?: string[];
  timeoutMs?: number;
}

export interface RunCodeResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
}

export interface CodeTestCase {
  id: string;
  input: unknown[];
  expected: unknown;
  hidden?: boolean;
}

export interface CheckCodeRequest {
  language: CodeLanguage;
  code: string;
  tests: CodeTestCase[];
  dependencies?: string[];
  timeoutMs?: number;
}

export interface CodeTestResult {
  testId: string;
  passed: boolean;
  input?: unknown[];
  expected?: unknown;
  actual?: unknown;
  stdout: string;
  stderr: string;
  durationMs: number;
  hidden: boolean;
  error?: string;
}

export interface CheckCodeResponse {
  passed: boolean;
  passedCount: number;
  totalCount: number;
  results: CodeTestResult[];
}

export interface MemoryInput {
  title?: string | null;
  description: string;
  target: string;
  sourceType?: string | null;
  tags?: string[] | null;
  importance?: number | null;
  memoryKind?: string | null;
  confidence?: number | null;
  stability?: string | null;
}

export interface MemoryItem {
  id: string;
  title: string;
  description: string;
  target: string;
  sourceType: string;
  tags: string[];
  importance: number;
  memoryKind: string;
  confidence: number;
  stability: string;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  accessCount: number;
}

export interface MemorySearchResult {
  item: MemoryItem;
  score: number;
  vectorScore: number;
  keywordScore: number;
}

export interface MemoryReviewItem {
  id: string;
  kind: string;
  item: MemoryItem;
  reason: string;
  score: number;
  duplicateOf?: MemoryItem | null;
  suggestedAction: string;
}

export interface MemoryImportResult {
  imported: number;
  skipped: number;
  updated: number;
  errors: string[];
}

export interface MemoryDecision {
  id: string;
  fingerprint: string;
  target: string;
  action: string;
  reason: string;
  itemTitle?: string | null;
  itemDescription?: string | null;
  score?: number | null;
  createdAt: number;
}

export interface MemoryLink {
  sourceId: string;
  targetId: string;
  label: string;
  weight: number;
}

export interface MemoryGraph {
  nodes: MemoryItem[];
  links: MemoryLink[];
}

export interface KnowledgeSource {
  id: string;
  path: string;
  title: string;
  sourceType: string;
  fingerprint: string;
  bytes: number;
  modifiedAt: number;
  createdAt: number;
  updatedAt: number;
  lastIndexedAt: number;
}

export interface KnowledgeChunk {
  id: string;
  sourceId: string;
  chunkIndex: number;
  text: string;
  target: string;
  page: number | null;
  startOffset: number;
  endOffset: number;
  fingerprint: string;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeSearchResult {
  chunk: KnowledgeChunk;
  source: KnowledgeSource;
  score: number;
  vectorScore: number;
  keywordScore: number;
}

export interface SearchPageResult {
  query: string;
  answer: string;
  memoryResults: MemorySearchResult[];
  knowledgeResults: KnowledgeSearchResult[];
  relatedMemory: RetrievalRelatedMemoryTrace[];
  sourceCount: number;
  chunkCount: number;
  usedModel: boolean;
}

export interface FeedbackInput {
  targetType: "message" | "memory" | "knowledge_chunk" | "knowledge_source" | string;
  targetId: string;
  target?: string | null;
  rating: "useful" | "not_useful" | string;
  note?: string | null;
}

export interface FeedbackSummary {
  targetType: string;
  positive: number;
  negative: number;
  total: number;
  score: number;
  latestAt: number;
}

export interface ResolvedTarget {
  kind: "chat" | "url" | "file" | "directory" | string;
  target: string;
  treeId?: string;
  nodeId?: string;
  messageId?: string;
  path?: string;
  absolutePath?: string;
  exists?: boolean;
  openable?: boolean;
}

export interface ProjectCommandSpec {
  kind: "build" | "run" | "test" | string;
  label: string;
  command: string;
}

export interface ProjectStackSummary {
  id: string;
  name: string;
  description: string;
  commands: ProjectCommandSpec[];
}

export interface CreateProjectRequest {
  name: string;
  stack: string;
  path?: string | null;
  description?: string | null;
}

export interface CreatedProject {
  name: string;
  stack: string;
  path: string;
  absolutePath: string;
  files: string[];
  commands: ProjectCommandSpec[];
}

export interface RunProjectCommandRequest {
  path: string;
  stack: string;
  commandKind: string;
  timeoutMs?: number | null;
}

export interface ProjectCommandResult {
  command: string;
  cwd: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  diagnosis: string;
}

export interface AgentRunInput {
  treeId?: string | null;
  nodeId?: string | null;
  title?: string | null;
  goal: string;
}

export interface AgentRun {
  id: string;
  treeId?: string | null;
  nodeId?: string | null;
  title: string;
  goal: string;
  prd: string;
  specs: string[];
  status: string;
  currentTaskId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AgentTask {
  id: string;
  runId: string;
  position: number;
  title: string;
  description: string;
  status: string;
  result?: string | null;
  error?: string | null;
  traceJson?: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt?: number | null;
  completedAt?: number | null;
}

export interface AgentRunDetail {
  run: AgentRun;
  tasks: AgentTask[];
}

export interface TerminalCommandRequest {
  command: string;
  cwd?: string | null;
  timeoutMs?: number | null;
  approved?: boolean | null;
}

export interface TerminalCommandSafety {
  command: string;
  cwd: string;
  requiresApproval: boolean;
  reasons: string[];
  blocked: boolean;
  blockReason?: string | null;
}

export interface TerminalCommandResult {
  command: string;
  cwd: string;
  approved: boolean;
  safety: TerminalCommandSafety;
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  diagnosis: string;
}

export interface TerminalCommandHistoryItem {
  id: string;
  command: string;
  cwd: string;
  approved: boolean;
  requiresApproval: boolean;
  reasons: string[];
  success: boolean;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  diagnosis: string;
  stdout: string;
  stderr: string;
  createdAt: number;
}

export type SettingsInput = ChatSettings;

const FALLBACK_SETTINGS: ChatSettings = {
  endpoint: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4.1-mini",
  api_key: "",
  theme: "Minimal Light",
  language: "English",
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
  setNodeColor: (
    treeId: string,
    nodeId: string,
    color: string | null,
    includeDescendants: boolean,
  ) =>
    invokeDesktop<void>("set_node_color", {
      treeId,
      nodeId,
      color,
      includeDescendants,
    }),
  deleteNode: (treeId: string, nodeId: string) =>
    invokeDesktop<DeleteNodeResult>("delete_node", { treeId, nodeId }),
  getTreeLayout: (treeId: string) =>
    isTauriRuntime() ? invoke<LayoutNode[]>("get_tree_layout", { treeId }) : Promise.resolve([]),
  getSettings: () =>
    isTauriRuntime() ? invoke<ChatSettings>("get_settings") : Promise.resolve(FALLBACK_SETTINGS),
  saveSettings: (input: SettingsInput) => invokeDesktop<ChatSettings>("save_settings", { input }),
  extractPdfText: (bytes: number[]) => invokeDesktop<string>("extract_pdf_text", { bytes }),
  getMessages: (treeId: string, nodeId: string) =>
    invokeDesktop<Message[]>("get_messages", { treeId, nodeId }),
  addUserMessage: (treeId: string, nodeId: string, content: string) =>
    invokeDesktop<Message>("add_user_message", { treeId, nodeId, content }),
  editUserMessage: (treeId: string, messageId: string, content: string) =>
    invokeDesktop<Message>("edit_user_message", { treeId, messageId, content }),
  reviseAssistantMessage: (treeId: string, messageId: string, instruction: string) =>
    invokeDesktop<Message>("revise_assistant_message", { treeId, messageId, instruction }),
  regenerateAssistantReply: (treeId: string, messageId: string, requestId: string) =>
    invokeDesktop<AssistantReplyResult>("regenerate_assistant_reply", {
      treeId,
      messageId,
      requestId,
    }),
  getQuizAttempts: (treeId: string, nodeId: string) =>
    invokeDesktop<QuizAttempt[]>("get_quiz_attempts", { treeId, nodeId }),
  saveQuizAttempt: (
    treeId: string,
    nodeId: string,
    messageId: string,
    quizId: string,
    quizType: string,
    answerJson: string,
    isCorrect: boolean,
    score: number,
    maxScore: number,
    explanation: string,
  ) =>
    invokeDesktop<QuizAttempt>("save_quiz_attempt", {
      treeId,
      nodeId,
      messageId,
      quizId,
      quizType,
      answerJson,
      isCorrect,
      score,
      maxScore,
      explanation,
    }),
  generateAssistantReply: (treeId: string, nodeId: string, requestId: string) =>
    invokeDesktop<AssistantReplyResult>("generate_assistant_reply", { treeId, nodeId, requestId }),
  confirmPendingBranches: (treeId: string, nodeId: string, titles?: string[]) =>
    invokeDesktop<AssistantReplyResult>("confirm_pending_branches", { treeId, nodeId, titles }),
  forceBranchSplit: (treeId: string, nodeId: string) =>
    invokeDesktop<AssistantReplyResult>("force_branch_split", { treeId, nodeId }),
  listConnectors: () =>
    isTauriRuntime() ? invoke<ConnectorSummary[]>("list_connectors") : Promise.resolve([]),
  proposeConnector: (treeId: string, nodeId: string, request: string) =>
    invokeDesktop<ConnectorSummary>("propose_connector", { treeId, nodeId, request }),
  setConnectorEnabled: (id: string, enabled: boolean) =>
    invokeDesktop<ConnectorSummary>("set_connector_enabled", { id, enabled }),
  runCode: (request: RunCodeRequest) => invokeDesktop<RunCodeResponse>("run_code", { request }),
  checkCode: (request: CheckCodeRequest) =>
    invokeDesktop<CheckCodeResponse>("check_code", { request }),
  addMemory: (input: MemoryInput) => invokeDesktop<MemoryItem>("add_memory", { input }),
  updateMemory: (id: string, input: MemoryInput) =>
    invokeDesktop<MemoryItem>("update_memory", { id, input }),
  mergeMemory: (keepId: string, removeId: string) =>
    invokeDesktop<MemoryItem>("merge_memory", { keepId, removeId }),
  searchMemory: (query: string, limit = 12) =>
    invokeDesktop<MemorySearchResult[]>("search_memory", { query, limit }),
  searchKnowledge: (query: string, limit = 12) =>
    invokeDesktop<KnowledgeSearchResult[]>("search_knowledge", { query, limit }),
  searchPage: (query: string, limit = 10) =>
    invokeDesktop<SearchPageResult>("search_page", { query, limit }),
  listMemoryRecent: (limit = 24) =>
    isTauriRuntime()
      ? invoke<MemoryItem[]>("list_memory_recent", { limit })
      : Promise.resolve([]),
  listMemoryDecisions: (limit = 24) =>
    isTauriRuntime()
      ? invoke<MemoryDecision[]>("list_memory_decisions", { limit })
      : Promise.resolve([]),
  listMemoryReview: (limit = 24) =>
    isTauriRuntime()
      ? invoke<MemoryReviewItem[]>("list_memory_review", { limit })
      : Promise.resolve([]),
  exportMemory: () => invokeDesktop<string>("export_memory"),
  importMemory: (json: string) =>
    invokeDesktop<MemoryImportResult>("import_memory", { json }),
  deleteMemory: (id: string) => invokeDesktop<void>("delete_memory", { id }),
  recordFeedback: (input: FeedbackInput) => invokeDesktop<void>("record_feedback", { input }),
  listFeedbackSummary: (limit = 12) =>
    isTauriRuntime()
      ? invoke<FeedbackSummary[]>("list_feedback_summary", { limit })
      : Promise.resolve([]),
  getMemoryGraph: (limit = 36) =>
    isTauriRuntime()
      ? invoke<MemoryGraph>("get_memory_graph", { limit })
      : Promise.resolve({ nodes: [], links: [] }),
  listWatchedPaths: () =>
    isTauriRuntime() ? invoke<WatchedPath[]>("list_watched_paths") : Promise.resolve([]),
  watchPath: (path: string) =>
    invokeDesktop<WatchedPath[]>("watch_path", { path }),
  unwatchPath: (path: string) =>
    invokeDesktop<WatchedPath[]>("unwatch_path", { path }),
  pollWatchedPaths: () => invokeDesktop<unknown>("poll_watched_paths"),
  resolveTarget: (target: string) =>
    invokeDesktop<ResolvedTarget>("resolve_target", { target }),
  listProjectStacks: () =>
    isTauriRuntime()
      ? invoke<ProjectStackSummary[]>("list_project_stacks")
      : Promise.resolve([]),
  createProject: (request: CreateProjectRequest) =>
    invokeDesktop<CreatedProject>("create_project", { request }),
  runProjectCommand: (request: RunProjectCommandRequest) =>
    invokeDesktop<ProjectCommandResult>("run_project_command", { request }),
  assessTerminalCommand: (request: TerminalCommandRequest) =>
    invokeDesktop<TerminalCommandSafety>("assess_terminal_command", { request }),
  runTerminalCommand: (request: TerminalCommandRequest) =>
    invokeDesktop<TerminalCommandResult>("run_terminal_command", { request }),
  listTerminalHistory: (limit = 30) =>
    isTauriRuntime()
      ? invoke<TerminalCommandHistoryItem[]>("list_terminal_history", { limit })
      : Promise.resolve([]),
  listAgentRuns: (limit = 12) =>
    isTauriRuntime()
      ? invoke<AgentRunDetail[]>("list_agent_runs", { limit })
      : Promise.resolve([]),
  createAgentRun: (input: AgentRunInput) =>
    invokeDesktop<AgentRunDetail>("create_agent_run", { input }),
  advanceAgentRun: (runId: string, requestId: string) =>
    invokeDesktop<AgentRunDetail>("advance_agent_run", { runId, requestId }),
};
