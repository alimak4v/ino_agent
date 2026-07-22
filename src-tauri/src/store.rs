use crate::context_builder;
use crate::local_embedding;
use crate::terminal;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row, ToSql, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

const APP_NAME: &str = "ino-agent";
const DB_FILENAME: &str = "ino-agent.sqlite3";
const LEGACY_APP_NAME: &str = "treeAI";
const LEGACY_DB_FILENAME: &str = "treeai.sqlite3";
const DEFAULT_ENDPOINT: &str = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL: &str = "gpt-4.1-mini";
const DEFAULT_THEME: &str = "Minimal Light";
const DEFAULT_LANGUAGE: &str = "English";
const API_CONTEXT_RECENT_MESSAGE_LIMIT: usize = 16;
const API_CONTEXT_SUMMARY_CHAR_LIMIT: usize = 420;
const API_CONTEXT_MESSAGE_CHAR_LIMIT: usize = 12_000;
const DIRECT_ATTACHMENT_FENCE: &str = "```ino-agent-attachment\n";
const MEMORY_GRAPH_LINK_LIMIT: usize = 6;
const WATCHED_PATHS_SETTING: &str = "knowledge_watched_paths";

fn normalize_theme(theme: &str) -> &'static str {
    match theme.trim() {
        "Minimal Light" => "Minimal Light",
        "Obsidian Dark" => "Obsidian Dark",
        "Paper" => "Paper",
        _ => DEFAULT_THEME,
    }
}

fn normalize_language(language: &str) -> &'static str {
    match language.trim().to_ascii_lowercase().as_str() {
        "english" | "en" => "English",
        "russian" | "ru" | "русский" => "Russian",
        "spanish" | "es" | "español" | "espanol" => "Spanish",
        "belarusian" | "belorussian" | "be" | "беларуская" | "белорусский" => "Belarusian",
        _ => DEFAULT_LANGUAGE,
    }
}

fn default_language() -> String {
    DEFAULT_LANGUAGE.to_string()
}
const NODE_COLORS: [&str; 6] = ["slate", "sky", "mint", "amber", "rose", "violet"];

fn normalize_watched_path(path: &str) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Path is empty.".to_string());
    }
    Ok(path.chars().take(4096).collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeSummary {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_node_id: Option<String>,
    pub message_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeCreated {
    pub tree_id: String,
    pub root_node_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub tree_id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub summary: Option<String>,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub tree_id: String,
    pub node_id: String,
    pub role: String,
    pub content: String,
    pub visualization_html: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizAttempt {
    pub id: String,
    pub tree_id: String,
    pub node_id: String,
    pub message_id: String,
    pub quiz_id: String,
    pub quiz_type: String,
    pub answer_json: String,
    pub is_correct: bool,
    pub score: f64,
    pub max_score: f64,
    pub explanation: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSettings {
    pub endpoint: String,
    pub model: String,
    pub api_key: String,
    pub theme: String,
    #[serde(default = "default_language")]
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsInput {
    pub endpoint: String,
    pub model: String,
    pub api_key: String,
    pub theme: String,
    #[serde(default = "default_language")]
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiBranchCreated {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantReplyResult {
    pub message: Message,
    pub selected_node_id: String,
    pub created_branches: Vec<AiBranchCreated>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteNodeResult {
    pub parent_id: Option<String>,
    pub deleted_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub summary: Option<String>,
    pub color: Option<String>,
    pub x: f64,
    pub y: f64,
    pub selected: bool,
    pub is_leaf: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatContextMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone)]
struct PathContextNode {
    title: String,
    summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchPlanItem {
    pub title: String,
    pub context: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchPlan {
    pub question: String,
    pub branches: Vec<BranchPlanItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInput {
    pub title: Option<String>,
    pub description: String,
    pub target: String,
    pub source_type: Option<String>,
    pub tags: Option<Vec<String>>,
    pub importance: Option<f64>,
    pub memory_kind: Option<String>,
    pub confidence: Option<f64>,
    pub stability: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryItem {
    pub id: String,
    pub title: String,
    pub description: String,
    pub target: String,
    pub source_type: String,
    pub tags: Vec<String>,
    pub importance: f64,
    pub memory_kind: String,
    pub confidence: f64,
    pub stability: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_accessed_at: i64,
    pub access_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchResult {
    pub item: MemoryItem,
    pub score: f64,
    pub vector_score: f64,
    pub keyword_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReviewItem {
    pub id: String,
    pub kind: String,
    pub item: MemoryItem,
    pub reason: String,
    pub score: f64,
    pub duplicate_of: Option<MemoryItem>,
    pub suggested_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryExport {
    pub version: i64,
    pub exported_at: i64,
    pub items: Vec<MemoryItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub updated: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDecision {
    pub id: String,
    pub fingerprint: String,
    pub target: String,
    pub action: String,
    pub reason: String,
    pub item_title: Option<String>,
    pub item_description: Option<String>,
    pub score: Option<f64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryLink {
    pub source_id: String,
    pub target_id: String,
    pub label: String,
    pub weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryGraph {
    pub nodes: Vec<MemoryItem>,
    pub links: Vec<MemoryLink>,
}

#[derive(Debug, Clone)]
pub struct KnowledgeSourceInput {
    pub path: String,
    pub title: String,
    pub source_type: String,
    pub fingerprint: String,
    pub bytes: i64,
    pub modified_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSource {
    pub id: String,
    pub path: String,
    pub title: String,
    pub source_type: String,
    pub fingerprint: String,
    pub bytes: i64,
    pub modified_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_indexed_at: i64,
}

#[derive(Debug, Clone)]
pub struct KnowledgeChunkInput {
    pub source_id: String,
    pub chunk_index: i64,
    pub text: String,
    pub target: String,
    pub page: Option<i64>,
    pub start_offset: i64,
    pub end_offset: i64,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeChunk {
    pub id: String,
    pub source_id: String,
    pub chunk_index: i64,
    pub text: String,
    pub target: String,
    pub page: Option<i64>,
    pub start_offset: i64,
    pub end_offset: i64,
    pub fingerprint: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSearchResult {
    pub chunk: KnowledgeChunk,
    pub source: KnowledgeSource,
    pub score: f64,
    pub vector_score: f64,
    pub keyword_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalTrace {
    pub query: String,
    pub memory_results: Vec<RetrievalMemoryTrace>,
    pub related_memory: Vec<RetrievalRelatedMemoryTrace>,
    pub knowledge_results: Vec<RetrievalKnowledgeTrace>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalMemoryTrace {
    pub id: String,
    pub title: String,
    pub target: String,
    pub source_type: String,
    pub score: f64,
    pub vector_score: f64,
    pub keyword_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalRelatedMemoryTrace {
    pub id: String,
    pub title: String,
    pub target: String,
    pub source_type: String,
    pub label: String,
    pub weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalKnowledgeTrace {
    pub chunk_id: String,
    pub source_id: String,
    pub title: String,
    pub target: String,
    pub source_type: String,
    pub start_offset: i64,
    pub end_offset: i64,
    pub score: f64,
    pub vector_score: f64,
    pub keyword_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackInput {
    pub target_type: String,
    pub target_id: String,
    pub target: Option<String>,
    pub rating: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackSummary {
    pub target_type: String,
    pub positive: i64,
    pub negative: i64,
    pub total: i64,
    pub score: f64,
    pub latest_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedPath {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunInput {
    pub tree_id: Option<String>,
    pub node_id: Option<String>,
    pub title: Option<String>,
    pub goal: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskDraft {
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunPlan {
    pub title: String,
    pub prd: String,
    pub specs: Vec<String>,
    pub tasks: Vec<AgentTaskDraft>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRun {
    pub id: String,
    pub tree_id: Option<String>,
    pub node_id: Option<String>,
    pub title: String,
    pub goal: String,
    pub prd: String,
    pub specs: Vec<String>,
    pub status: String,
    pub current_task_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTask {
    pub id: String,
    pub run_id: String,
    pub position: i64,
    pub title: String,
    pub description: String,
    pub status: String,
    pub result: Option<String>,
    pub error: Option<String>,
    pub trace_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunDetail {
    pub run: AgentRun,
    pub tasks: Vec<AgentTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandHistoryItem {
    pub id: String,
    pub command: String,
    pub cwd: String,
    pub approved: bool,
    pub requires_approval: bool,
    pub reasons: Vec<String>,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub duration_ms: i64,
    pub timed_out: bool,
    pub diagnosis: String,
    pub stdout: String,
    pub stderr: String,
    pub created_at: i64,
}

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn new() -> Result<Self, String> {
        let path = db_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        conn.execute("PRAGMA foreign_keys = ON", [])
            .map_err(|e| e.to_string())?;
        let store = Self { conn };
        store.init_db()?;
        store.migrate_db()?;
        store.remove_seed_data()?;
        store.remove_empty_default_trees()?;
        Ok(store)
    }

    fn now() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }

    fn init_db(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS trees (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    last_node_id TEXT
                );
                CREATE TABLE IF NOT EXISTS nodes (
                    id TEXT PRIMARY KEY,
                    tree_id TEXT NOT NULL,
                    parent_id TEXT,
                    title TEXT NOT NULL,
                    summary TEXT,
                    color TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    FOREIGN KEY(tree_id) REFERENCES trees(id) ON DELETE CASCADE,
                    FOREIGN KEY(parent_id) REFERENCES nodes(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    tree_id TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
                    content TEXT NOT NULL,
                    visualization_html TEXT,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY(tree_id) REFERENCES trees(id) ON DELETE CASCADE,
                    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS quiz_attempts (
                    id TEXT PRIMARY KEY,
                    tree_id TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    quiz_id TEXT NOT NULL,
                    quiz_type TEXT NOT NULL,
                    answer_json TEXT NOT NULL,
                    is_correct INTEGER NOT NULL,
                    score REAL NOT NULL,
                    max_score REAL NOT NULL,
                    explanation TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY(tree_id) REFERENCES trees(id) ON DELETE CASCADE,
                    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE,
                    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
                CREATE TABLE IF NOT EXISTS memory_items (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    target TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    tags TEXT NOT NULL,
                    importance REAL NOT NULL,
                    memory_kind TEXT NOT NULL DEFAULT 'note',
                    confidence REAL NOT NULL DEFAULT 0.7,
                    stability TEXT NOT NULL DEFAULT 'durable',
                    embedding BLOB NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    last_accessed_at INTEGER NOT NULL,
                    access_count INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS memory_links (
                    source_id TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    label TEXT NOT NULL,
                    weight REAL NOT NULL,
                    created_at INTEGER NOT NULL,
                    PRIMARY KEY(source_id, target_id),
                    FOREIGN KEY(source_id) REFERENCES memory_items(id) ON DELETE CASCADE,
                    FOREIGN KEY(target_id) REFERENCES memory_items(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS memory_ingest_runs (
                    fingerprint TEXT PRIMARY KEY,
                    source_kind TEXT NOT NULL,
                    target TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS memory_decisions (
                    id TEXT PRIMARY KEY,
                    fingerprint TEXT NOT NULL,
                    target TEXT NOT NULL,
                    action TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    item_title TEXT,
                    item_description TEXT,
                    score REAL,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS knowledge_sources (
                    id TEXT PRIMARY KEY,
                    path TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    bytes INTEGER NOT NULL,
                    modified_at INTEGER NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    last_indexed_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS knowledge_chunks (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    text TEXT NOT NULL,
                    target TEXT NOT NULL,
                    page INTEGER,
                    start_offset INTEGER NOT NULL,
                    end_offset INTEGER NOT NULL,
                    fingerprint TEXT NOT NULL,
                    embedding BLOB NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    UNIQUE(source_id, fingerprint),
                    FOREIGN KEY(source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS feedback_events (
                    id TEXT PRIMARY KEY,
                    target_type TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    target TEXT,
                    rating TEXT NOT NULL,
                    note TEXT,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS agent_runs (
                    id TEXT PRIMARY KEY,
                    tree_id TEXT,
                    node_id TEXT,
                    title TEXT NOT NULL,
                    goal TEXT NOT NULL,
                    prd TEXT NOT NULL,
                    specs_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    current_task_id TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    FOREIGN KEY(tree_id) REFERENCES trees(id) ON DELETE SET NULL,
                    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE SET NULL
                );
                CREATE TABLE IF NOT EXISTS agent_tasks (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    status TEXT NOT NULL,
                    result TEXT,
                    error TEXT,
                    trace_json TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    started_at INTEGER,
                    completed_at INTEGER,
                    UNIQUE(run_id, position),
                    FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS terminal_command_history (
                    id TEXT PRIMARY KEY,
                    command TEXT NOT NULL,
                    cwd TEXT NOT NULL,
                    approved INTEGER NOT NULL,
                    requires_approval INTEGER NOT NULL,
                    reasons_json TEXT NOT NULL,
                    success INTEGER NOT NULL,
                    exit_code INTEGER,
                    duration_ms INTEGER NOT NULL,
                    timed_out INTEGER NOT NULL,
                    diagnosis TEXT NOT NULL,
                    stdout TEXT NOT NULL,
                    stderr TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_memory_items_updated_at
                    ON memory_items(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_memory_links_target
                    ON memory_links(target_id);
                CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source
                    ON knowledge_chunks(source_id, chunk_index);
                CREATE INDEX IF NOT EXISTS idx_knowledge_sources_updated
                    ON knowledge_sources(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_feedback_events_target
                    ON feedback_events(target_type, target_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_agent_runs_updated
                    ON agent_runs(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_agent_tasks_run_position
                    ON agent_tasks(run_id, position);
                CREATE INDEX IF NOT EXISTS idx_terminal_command_history_created
                    ON terminal_command_history(created_at DESC);
                CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts
                    USING fts5(
                        chunk_id UNINDEXED,
                        source_id UNINDEXED,
                        text,
                        target,
                        source_title,
                        source_path,
                        tokenize = 'unicode61'
                    );
                ",
            )
            .map_err(|e| e.to_string())
    }

    fn migrate_db(&self) -> Result<(), String> {
        let mut stmt = self
            .conn
            .prepare("PRAGMA table_info(messages)")
            .map_err(|e| e.to_string())?;
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if !columns.iter().any(|column| column == "visualization_html") {
            self.conn
                .execute(
                    "ALTER TABLE messages ADD COLUMN visualization_html TEXT",
                    [],
                )
                .map_err(|e| e.to_string())?;
        }

        let mut stmt = self
            .conn
            .prepare("PRAGMA table_info(nodes)")
            .map_err(|e| e.to_string())?;
        let node_columns = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if !node_columns.iter().any(|column| column == "color") {
            self.conn
                .execute("ALTER TABLE nodes ADD COLUMN color TEXT", [])
                .map_err(|e| e.to_string())?;
        }
        let mut stmt = self
            .conn
            .prepare("PRAGMA table_info(memory_items)")
            .map_err(|e| e.to_string())?;
        let memory_columns = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if !memory_columns.iter().any(|column| column == "memory_kind") {
            self.conn
                .execute(
                    "ALTER TABLE memory_items ADD COLUMN memory_kind TEXT NOT NULL DEFAULT 'note'",
                    [],
                )
                .map_err(|e| e.to_string())?;
        }
        if !memory_columns.iter().any(|column| column == "confidence") {
            self.conn
                .execute(
                    "ALTER TABLE memory_items ADD COLUMN confidence REAL NOT NULL DEFAULT 0.7",
                    [],
                )
                .map_err(|e| e.to_string())?;
        }
        if !memory_columns.iter().any(|column| column == "stability") {
            self.conn
                .execute(
                    "ALTER TABLE memory_items ADD COLUMN stability TEXT NOT NULL DEFAULT 'durable'",
                    [],
                )
                .map_err(|e| e.to_string())?;
        }
        self.conn
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS quiz_attempts (
                    id TEXT PRIMARY KEY,
                    tree_id TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    quiz_id TEXT NOT NULL,
                    quiz_type TEXT NOT NULL,
                    answer_json TEXT NOT NULL,
                    is_correct INTEGER NOT NULL,
                    score REAL NOT NULL,
                    max_score REAL NOT NULL,
                    explanation TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY(tree_id) REFERENCES trees(id) ON DELETE CASCADE,
                    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE,
                    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS memory_items (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    target TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    tags TEXT NOT NULL,
                    importance REAL NOT NULL,
                    memory_kind TEXT NOT NULL DEFAULT 'note',
                    confidence REAL NOT NULL DEFAULT 0.7,
                    stability TEXT NOT NULL DEFAULT 'durable',
                    embedding BLOB NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    last_accessed_at INTEGER NOT NULL,
                    access_count INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS memory_links (
                    source_id TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    label TEXT NOT NULL,
                    weight REAL NOT NULL,
                    created_at INTEGER NOT NULL,
                    PRIMARY KEY(source_id, target_id),
                    FOREIGN KEY(source_id) REFERENCES memory_items(id) ON DELETE CASCADE,
                    FOREIGN KEY(target_id) REFERENCES memory_items(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS memory_ingest_runs (
                    fingerprint TEXT PRIMARY KEY,
                    source_kind TEXT NOT NULL,
                    target TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS memory_decisions (
                    id TEXT PRIMARY KEY,
                    fingerprint TEXT NOT NULL,
                    target TEXT NOT NULL,
                    action TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    item_title TEXT,
                    item_description TEXT,
                    score REAL,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS knowledge_sources (
                    id TEXT PRIMARY KEY,
                    path TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    bytes INTEGER NOT NULL,
                    modified_at INTEGER NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    last_indexed_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS knowledge_chunks (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    text TEXT NOT NULL,
                    target TEXT NOT NULL,
                    page INTEGER,
                    start_offset INTEGER NOT NULL,
                    end_offset INTEGER NOT NULL,
                    fingerprint TEXT NOT NULL,
                    embedding BLOB NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    UNIQUE(source_id, fingerprint),
                    FOREIGN KEY(source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS feedback_events (
                    id TEXT PRIMARY KEY,
                    target_type TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    target TEXT,
                    rating TEXT NOT NULL,
                    note TEXT,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS agent_runs (
                    id TEXT PRIMARY KEY,
                    tree_id TEXT,
                    node_id TEXT,
                    title TEXT NOT NULL,
                    goal TEXT NOT NULL,
                    prd TEXT NOT NULL,
                    specs_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    current_task_id TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    FOREIGN KEY(tree_id) REFERENCES trees(id) ON DELETE SET NULL,
                    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE SET NULL
                );
                CREATE TABLE IF NOT EXISTS agent_tasks (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    status TEXT NOT NULL,
                    result TEXT,
                    error TEXT,
                    trace_json TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    started_at INTEGER,
                    completed_at INTEGER,
                    UNIQUE(run_id, position),
                    FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS terminal_command_history (
                    id TEXT PRIMARY KEY,
                    command TEXT NOT NULL,
                    cwd TEXT NOT NULL,
                    approved INTEGER NOT NULL,
                    requires_approval INTEGER NOT NULL,
                    reasons_json TEXT NOT NULL,
                    success INTEGER NOT NULL,
                    exit_code INTEGER,
                    duration_ms INTEGER NOT NULL,
                    timed_out INTEGER NOT NULL,
                    diagnosis TEXT NOT NULL,
                    stdout TEXT NOT NULL,
                    stderr TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_memory_items_updated_at
                    ON memory_items(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_memory_links_target
                    ON memory_links(target_id);
                CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source
                    ON knowledge_chunks(source_id, chunk_index);
                CREATE INDEX IF NOT EXISTS idx_knowledge_sources_updated
                    ON knowledge_sources(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_feedback_events_target
                    ON feedback_events(target_type, target_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_agent_runs_updated
                    ON agent_runs(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_agent_tasks_run_position
                    ON agent_tasks(run_id, position);
                CREATE INDEX IF NOT EXISTS idx_terminal_command_history_created
                    ON terminal_command_history(created_at DESC);
                CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts
                    USING fts5(
                        chunk_id UNINDEXED,
                        source_id UNINDEXED,
                        text,
                        target,
                        source_title,
                        source_path,
                        tokenize = 'unicode61'
                    );
                ",
            )
            .map_err(|e| e.to_string())?;
        self.rebuild_knowledge_fts()?;
        Ok(())
    }

    fn get_setting(&self, key: &str, default: &str) -> Result<String, String> {
        self.conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())
            .map(|value| value.unwrap_or_else(|| default.to_string()))
    }

    fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO settings(key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn branch_plan_key(tree_id: &str, node_id: &str) -> String {
        format!("branch_plan:{tree_id}:{node_id}")
    }

    pub fn get_pending_branch_plan(
        &self,
        tree_id: &str,
        node_id: &str,
    ) -> Result<Option<BranchPlan>, String> {
        let raw = self.get_setting(&Self::branch_plan_key(tree_id, node_id), "")?;
        if raw.trim().is_empty() {
            return Ok(None);
        }
        serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| e.to_string())
    }

    pub fn save_pending_branch_plan(
        &self,
        tree_id: &str,
        node_id: &str,
        plan: &BranchPlan,
    ) -> Result<(), String> {
        let raw = serde_json::to_string(plan).map_err(|e| e.to_string())?;
        self.set_setting(&Self::branch_plan_key(tree_id, node_id), &raw)
    }

    pub fn clear_pending_branch_plan(&self, tree_id: &str, node_id: &str) -> Result<(), String> {
        self.set_setting(&Self::branch_plan_key(tree_id, node_id), "")
    }

    pub fn list_watched_paths(&self) -> Result<Vec<WatchedPath>, String> {
        let raw = self.get_setting(WATCHED_PATHS_SETTING, "[]")?;
        let mut paths = serde_json::from_str::<Vec<WatchedPath>>(&raw).unwrap_or_default();
        paths.sort_by(|a, b| a.path.cmp(&b.path));
        paths.dedup_by(|a, b| a.path == b.path);
        Ok(paths)
    }

    pub fn add_watched_path(&self, path: &str) -> Result<Vec<WatchedPath>, String> {
        let path = normalize_watched_path(path)?;
        let mut paths = self.list_watched_paths()?;
        if !paths.iter().any(|item| item.path == path) {
            paths.push(WatchedPath { path });
        }
        paths.sort_by(|a, b| a.path.cmp(&b.path));
        self.save_watched_paths(&paths)?;
        Ok(paths)
    }

    pub fn remove_watched_path(&self, path: &str) -> Result<Vec<WatchedPath>, String> {
        let path = normalize_watched_path(path)?;
        let mut paths = self.list_watched_paths()?;
        paths.retain(|item| item.path != path);
        self.save_watched_paths(&paths)?;
        Ok(paths)
    }

    fn save_watched_paths(&self, paths: &[WatchedPath]) -> Result<(), String> {
        let raw = serde_json::to_string(paths).map_err(|e| e.to_string())?;
        self.set_setting(WATCHED_PATHS_SETTING, &raw)
    }

    fn remove_seed_data(&self) -> Result<(), String> {
        if self.get_setting("seed_data_removed", "")? == "1" {
            return Ok(());
        }
        for title in [
            "AI app idea",
            "Pricing strategy",
            "Book outline",
            "Architecture",
            "Customer research",
            "Marketing ideas",
        ] {
            let id = self
                .conn
                .query_row(
                    "SELECT id FROM trees WHERE title = ?1",
                    params![title],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some(id) = id {
                self.delete_tree(&id)?;
            }
        }
        self.set_setting("seed_data_removed", "1")
    }

    fn remove_empty_default_trees(&self) -> Result<(), String> {
        if self.get_setting("empty_default_trees_removed", "")? == "1" {
            return Ok(());
        }

        let mut stmt = self
            .conn
            .prepare(
                "SELECT t.id FROM trees t LEFT JOIN messages m ON m.tree_id = t.id
                 WHERE t.title = 'Untitled tree'
                 GROUP BY t.id HAVING COUNT(m.id) = 0",
            )
            .map_err(|e| e.to_string())?;
        let ids = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        for id in ids {
            self.delete_tree(&id)?;
        }
        self.set_setting("empty_default_trees_removed", "1")
    }

    pub fn list_trees(&self) -> Result<Vec<TreeSummary>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT t.id, t.title, t.created_at, t.updated_at, t.last_node_id,
                        COUNT(m.id) AS message_count
                 FROM trees t LEFT JOIN messages m ON m.tree_id = t.id
                 GROUP BY t.id ORDER BY t.updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TreeSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    last_node_id: row.get(4)?,
                    message_count: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn create_tree(&self, title: String) -> Result<TreeCreated, String> {
        let ts = Self::now();
        let tree_id = Uuid::new_v4().to_string();
        let root_node_id = Uuid::new_v4().to_string();
        let title = clean_title_or(title, "Root");

        self.conn
            .execute(
                "INSERT INTO trees(id, title, created_at, updated_at, last_node_id)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![tree_id, &title, ts, ts, root_node_id],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "INSERT INTO nodes(id, tree_id, parent_id, title, summary, created_at, updated_at)
                 VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6)",
                params![root_node_id, tree_id, &title, "Empty", ts, ts],
            )
            .map_err(|e| e.to_string())?;

        Ok(TreeCreated {
            tree_id,
            root_node_id,
        })
    }

    pub fn delete_tree(&self, tree_id: &str) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM quiz_attempts WHERE tree_id = ?1",
                params![tree_id],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute("DELETE FROM messages WHERE tree_id = ?1", params![tree_id])
            .map_err(|e| e.to_string())?;
        self.conn
            .execute("DELETE FROM nodes WHERE tree_id = ?1", params![tree_id])
            .map_err(|e| e.to_string())?;
        self.conn
            .execute("DELETE FROM trees WHERE id = ?1", params![tree_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_nodes(&self, tree_id: &str) -> Result<Vec<Node>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, tree_id, parent_id, title, summary, color, created_at, updated_at
                 FROM nodes WHERE tree_id = ?1 ORDER BY created_at",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![tree_id], |row| {
                Ok(Node {
                    id: row.get(0)?,
                    tree_id: row.get(1)?,
                    parent_id: row.get(2)?,
                    title: row.get(3)?,
                    summary: row.get(4)?,
                    color: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn get_node(&self, tree_id: &str, node_id: &str) -> Result<Node, String> {
        self.conn
            .query_row(
                "SELECT id, tree_id, parent_id, title, summary, color, created_at, updated_at
                 FROM nodes WHERE tree_id = ?1 AND id = ?2",
                params![tree_id, node_id],
                |row| {
                    Ok(Node {
                        id: row.get(0)?,
                        tree_id: row.get(1)?,
                        parent_id: row.get(2)?,
                        title: row.get(3)?,
                        summary: row.get(4)?,
                        color: row.get(5)?,
                        created_at: row.get(6)?,
                        updated_at: row.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Node not found.".to_string())
    }

    pub fn is_leaf_node(&self, tree_id: &str, node_id: &str) -> Result<bool, String> {
        self.get_node(tree_id, node_id)?;
        let count = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM nodes WHERE tree_id = ?1 AND parent_id = ?2",
                params![tree_id, node_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(count == 0)
    }

    pub fn set_last_node(&self, tree_id: &str, node_id: &str) -> Result<(), String> {
        let updated = self
            .conn
            .execute(
                "UPDATE trees SET last_node_id = ?1, updated_at = ?2
                 WHERE id = ?3 AND EXISTS (
                    SELECT 1 FROM nodes WHERE id = ?1 AND tree_id = ?3
                 )",
                params![node_id, Self::now(), tree_id],
            )
            .map_err(|e| e.to_string())?;
        if updated == 0 {
            return Err("Cannot select a node outside this tree.".to_string());
        }
        Ok(())
    }

    pub fn create_child_node(
        &self,
        tree_id: &str,
        parent_id: &str,
        title: String,
    ) -> Result<String, String> {
        self.get_node(tree_id, parent_id)?;
        let title = clean_title_or(title, "New node");
        let ts = Self::now();
        let node_id = Uuid::new_v4().to_string();
        self.conn
            .execute(
                "INSERT INTO nodes(id, tree_id, parent_id, title, summary, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![node_id, tree_id, parent_id, title, "Empty", ts, ts],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "UPDATE trees SET updated_at = ?1 WHERE id = ?2",
                params![ts, tree_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(node_id)
    }

    pub fn create_branches_from_plan(
        &mut self,
        tree_id: &str,
        node_id: &str,
        parent_title: &str,
        plan: &BranchPlan,
    ) -> Result<AssistantReplyResult, String> {
        self.get_node(tree_id, node_id)?;
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        let ts = Self::now();
        let mut created = Vec::new();

        for item in &plan.branches {
            let child_id = Uuid::new_v4().to_string();
            let title = clean_title_or(item.title.clone(), "New node");
            let summary = clean_node_summary(&item.context, &title);
            tx.execute(
                "INSERT INTO nodes(id, tree_id, parent_id, title, summary, color, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7)",
                params![child_id, tree_id, node_id, &title, summary, ts, ts],
            )
            .map_err(|e| e.to_string())?;
            insert_message_tx(
                &tx,
                tree_id,
                &child_id,
                "assistant",
                &branch_context_message(parent_title, item),
                None,
            )?;
            created.push(AiBranchCreated {
                id: child_id,
                title,
            });
        }

        let content = if created.is_empty() {
            "Не получилось создать ветки из плана.".to_string()
        } else {
            let list = created
                .iter()
                .map(|branch| format!("- {}", branch.title))
                .collect::<Vec<_>>()
                .join("\n");
            format!(
                "Готово, создал отдельные ветки:\n\n{list}\n\nВ каждой ветке уже есть короткое описание контекста."
            )
        };
        let message = insert_message_tx(&tx, tree_id, node_id, "assistant", &content, None)?;
        let selected_node_id = created
            .first()
            .map(|branch| branch.id.clone())
            .unwrap_or_else(|| node_id.to_string());
        tx.execute(
            "INSERT INTO settings(key, value) VALUES (?1, '')
             ON CONFLICT(key) DO UPDATE SET value = ''",
            params![Self::branch_plan_key(tree_id, node_id)],
        )
        .map_err(|e| e.to_string())?;
        let updated = tx
            .execute(
                "UPDATE trees SET last_node_id = ?1, updated_at = ?2
                 WHERE id = ?3 AND EXISTS (
                    SELECT 1 FROM nodes WHERE id = ?1 AND tree_id = ?3
                 )",
                params![&selected_node_id, Self::now(), tree_id],
            )
            .map_err(|e| e.to_string())?;
        if updated == 0 {
            return Err("Cannot select a node outside this tree.".to_string());
        }
        tx.commit().map_err(|e| e.to_string())?;

        Ok(AssistantReplyResult {
            message,
            selected_node_id,
            created_branches: created,
        })
    }

    pub fn rename_node(&self, tree_id: &str, node_id: &str, title: &str) -> Result<(), String> {
        let title = title.trim().chars().take(96).collect::<String>();
        if title.is_empty() {
            return Ok(());
        }
        let ts = Self::now();
        self.conn
            .execute(
                "UPDATE nodes SET title = ?1, updated_at = ?2 WHERE id = ?3 AND tree_id = ?4",
                params![&title, ts, node_id, tree_id],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "UPDATE trees SET updated_at = ?1 WHERE id = ?2",
                params![ts, tree_id],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "UPDATE trees SET title = ?1 WHERE id = ?2 AND EXISTS (
                    SELECT 1 FROM nodes WHERE id = ?3 AND tree_id = ?2 AND parent_id IS NULL
                )",
                params![&title, tree_id, node_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn set_node_color(
        &self,
        tree_id: &str,
        node_id: &str,
        color: Option<String>,
        include_descendants: bool,
    ) -> Result<(), String> {
        self.get_node(tree_id, node_id)?;
        let color = normalize_node_color(color)?;
        let ts = Self::now();
        if include_descendants {
            self.conn
                .execute(
                    "WITH RECURSIVE subtree(id) AS (
                        SELECT id FROM nodes WHERE id = ?1 AND tree_id = ?2
                        UNION ALL
                        SELECT n.id FROM nodes n JOIN subtree s ON n.parent_id = s.id
                        WHERE n.tree_id = ?2
                    )
                    UPDATE nodes SET color = ?3, updated_at = ?4
                    WHERE tree_id = ?2 AND id IN (SELECT id FROM subtree)",
                    params![node_id, tree_id, color.as_deref(), ts],
                )
                .map_err(|e| e.to_string())?;
        } else {
            self.conn
                .execute(
                    "UPDATE nodes SET color = ?1, updated_at = ?2 WHERE id = ?3 AND tree_id = ?4",
                    params![color.as_deref(), ts, node_id, tree_id],
                )
                .map_err(|e| e.to_string())?;
        }
        self.conn
            .execute(
                "UPDATE trees SET updated_at = ?1 WHERE id = ?2",
                params![ts, tree_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_node(&self, tree_id: &str, node_id: &str) -> Result<DeleteNodeResult, String> {
        let parent_id = self
            .conn
            .query_row(
                "SELECT parent_id FROM nodes WHERE id = ?1 AND tree_id = ?2",
                params![node_id, tree_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
        let Some(parent_id) = parent_id else {
            return Ok(DeleteNodeResult {
                parent_id: None,
                deleted_ids: Vec::new(),
            });
        };

        let mut stmt = self
            .conn
            .prepare(
                "WITH RECURSIVE subtree(id) AS (
                    SELECT id FROM nodes WHERE id = ?1 AND tree_id = ?2
                    UNION ALL
                    SELECT n.id FROM nodes n JOIN subtree s ON n.parent_id = s.id
                    WHERE n.tree_id = ?3
                ) SELECT id FROM subtree",
            )
            .map_err(|e| e.to_string())?;
        let deleted_ids = stmt
            .query_map(params![node_id, tree_id, tree_id], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        for id in &deleted_ids {
            self.conn
                .execute(
                    "DELETE FROM quiz_attempts WHERE tree_id = ?1 AND node_id = ?2",
                    params![tree_id, id],
                )
                .map_err(|e| e.to_string())?;
            self.conn
                .execute(
                    "DELETE FROM messages WHERE tree_id = ?1 AND node_id = ?2",
                    params![tree_id, id],
                )
                .map_err(|e| e.to_string())?;
            self.conn
                .execute(
                    "DELETE FROM nodes WHERE tree_id = ?1 AND id = ?2",
                    params![tree_id, id],
                )
                .map_err(|e| e.to_string())?;
        }
        self.conn
            .execute(
                "UPDATE trees SET updated_at = ?1 WHERE id = ?2",
                params![Self::now(), tree_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(DeleteNodeResult {
            parent_id: Some(parent_id),
            deleted_ids,
        })
    }

    pub fn add_message(
        &mut self,
        tree_id: &str,
        node_id: &str,
        role: &str,
        content: &str,
    ) -> Result<Message, String> {
        self.add_message_with_visualization(tree_id, node_id, role, content, None)
    }

    pub fn add_message_with_visualization(
        &mut self,
        tree_id: &str,
        node_id: &str,
        role: &str,
        content: &str,
        visualization_html: Option<String>,
    ) -> Result<Message, String> {
        let content = content.trim();
        if content.is_empty() {
            return Err("Message is empty.".into());
        }
        self.get_node(tree_id, node_id)?;

        let ts = Self::now();
        let message_id = Uuid::new_v4().to_string();
        self.conn
            .execute(
                "INSERT INTO messages(id, tree_id, node_id, role, content, visualization_html, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    message_id,
                    tree_id,
                    node_id,
                    role,
                    content,
                    visualization_html.as_deref(),
                    ts
                ],
            )
            .map_err(|e| e.to_string())?;

        let snippet = first_line(content).chars().take(46).collect::<String>();
        let (title, summary) = self.node_title_summary(node_id)?;
        if role == "user" && (title == "Root" || title == "New node") {
            self.conn
                .execute(
                    "UPDATE nodes SET title = ?1, summary = ?2, updated_at = ?3 WHERE id = ?4",
                    params![snippet, snippet, ts, node_id],
                )
                .map_err(|e| e.to_string())?;
        } else if role == "assistant"
            && (summary.is_none()
                || summary.as_deref() == Some("Empty")
                || summary.as_deref() == Some(""))
        {
            self.conn
                .execute(
                    "UPDATE nodes SET summary = ?1, updated_at = ?2 WHERE id = ?3",
                    params![snippet, ts, node_id],
                )
                .map_err(|e| e.to_string())?;
        } else {
            self.conn
                .execute(
                    "UPDATE nodes SET updated_at = ?1 WHERE id = ?2",
                    params![ts, node_id],
                )
                .map_err(|e| e.to_string())?;
        }
        self.set_last_node(tree_id, node_id)?;

        Ok(Message {
            id: message_id,
            tree_id: tree_id.to_string(),
            node_id: node_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            visualization_html,
            created_at: ts,
        })
    }

    pub fn edit_user_message(
        &mut self,
        tree_id: &str,
        message_id: &str,
        content: &str,
    ) -> Result<Message, String> {
        let content = content.trim();
        if content.is_empty() {
            return Err("Message is empty.".into());
        }

        let (existing_rowid, existing) = self
            .conn
            .query_row(
                "SELECT rowid, id, tree_id, node_id, role, content, visualization_html, created_at
                 FROM messages WHERE tree_id = ?1 AND id = ?2",
                params![tree_id, message_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        Message {
                            id: row.get(1)?,
                            tree_id: row.get(2)?,
                            node_id: row.get(3)?,
                            role: row.get(4)?,
                            content: row.get(5)?,
                            visualization_html: row.get(6)?,
                            created_at: row.get(7)?,
                        },
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Message not found.".to_string())?;

        if existing.role != "user" {
            return Err("Only user messages can be edited.".to_string());
        }
        if !self.is_leaf_node(tree_id, &existing.node_id)? {
            return Err(
                "Parent branches are read-only. Select or create a leaf branch.".to_string(),
            );
        }

        self.conn
            .execute(
                "DELETE FROM messages
                 WHERE tree_id = ?1 AND node_id = ?2 AND rowid > ?3",
                params![tree_id, existing.node_id, existing_rowid],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "UPDATE messages SET content = ?1, visualization_html = NULL WHERE id = ?2",
                params![content, message_id],
            )
            .map_err(|e| e.to_string())?;

        let ts = Self::now();
        let snippet = first_line(content).chars().take(46).collect::<String>();
        self.conn
            .execute(
                "UPDATE nodes SET summary = ?1, updated_at = ?2 WHERE id = ?3",
                params![snippet, ts, existing.node_id],
            )
            .map_err(|e| e.to_string())?;
        self.set_last_node(tree_id, &existing.node_id)?;

        Ok(Message {
            content: content.to_string(),
            visualization_html: None,
            ..existing
        })
    }

    pub fn update_assistant_message(
        &mut self,
        tree_id: &str,
        message_id: &str,
        content: &str,
    ) -> Result<Message, String> {
        let content = content.trim();
        if content.is_empty() {
            return Err("Message is empty.".into());
        }

        let existing = self
            .conn
            .query_row(
                "SELECT id, tree_id, node_id, role, content, visualization_html, created_at
                 FROM messages WHERE tree_id = ?1 AND id = ?2",
                params![tree_id, message_id],
                message_from_row,
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Message not found.".to_string())?;

        if existing.role != "assistant" {
            return Err("Only assistant messages can be revised in place.".to_string());
        }
        if !self.is_leaf_node(tree_id, &existing.node_id)? {
            return Err(
                "Parent branches are read-only. Select or create a leaf branch.".to_string(),
            );
        }

        self.conn
            .execute(
                "UPDATE messages SET content = ?1, visualization_html = NULL WHERE id = ?2",
                params![content, message_id],
            )
            .map_err(|e| e.to_string())?;
        let ts = Self::now();
        self.conn
            .execute(
                "UPDATE nodes SET summary = ?1, updated_at = ?2 WHERE tree_id = ?3 AND id = ?4",
                params![
                    first_line(content).chars().take(46).collect::<String>(),
                    ts,
                    tree_id,
                    existing.node_id
                ],
            )
            .map_err(|e| e.to_string())?;
        self.set_last_node(tree_id, &existing.node_id)?;

        Ok(Message {
            content: content.to_string(),
            visualization_html: None,
            ..existing
        })
    }

    pub fn get_message(&self, tree_id: &str, message_id: &str) -> Result<Message, String> {
        self.conn
            .query_row(
                "SELECT id, tree_id, node_id, role, content, visualization_html, created_at
                 FROM messages WHERE tree_id = ?1 AND id = ?2",
                params![tree_id, message_id],
                message_from_row,
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Message not found.".to_string())
    }

    pub fn truncate_from_assistant_message(
        &mut self,
        tree_id: &str,
        message_id: &str,
    ) -> Result<String, String> {
        let (message_rowid, node_id, role) = self
            .conn
            .query_row(
                "SELECT rowid, node_id, role FROM messages WHERE tree_id = ?1 AND id = ?2",
                params![tree_id, message_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Message not found.".to_string())?;

        if role != "assistant" {
            return Err("Only assistant messages can be regenerated.".to_string());
        }
        if !self.is_leaf_node(tree_id, &node_id)? {
            return Err(
                "Parent branches are read-only. Select or create a leaf branch.".to_string(),
            );
        }

        self.conn
            .execute(
                "DELETE FROM quiz_attempts
                 WHERE tree_id = ?1
                   AND node_id = ?2
                   AND message_id IN (
                     SELECT id FROM messages
                     WHERE tree_id = ?3 AND node_id = ?4 AND rowid >= ?5
                   )",
                params![tree_id, &node_id, tree_id, &node_id, message_rowid],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "DELETE FROM messages
                 WHERE tree_id = ?1 AND node_id = ?2 AND rowid >= ?3",
                params![tree_id, &node_id, message_rowid],
            )
            .map_err(|e| e.to_string())?;
        self.clear_pending_branch_plan(tree_id, &node_id)?;

        let ts = Self::now();
        self.conn
            .execute(
                "UPDATE nodes SET updated_at = ?1 WHERE tree_id = ?2 AND id = ?3",
                params![ts, tree_id, node_id],
            )
            .map_err(|e| e.to_string())?;
        self.set_last_node(tree_id, &node_id)?;

        Ok(node_id)
    }

    pub fn save_quiz_attempt(
        &self,
        tree_id: &str,
        node_id: &str,
        message_id: &str,
        quiz_id: &str,
        quiz_type: &str,
        answer_json: &str,
        is_correct: bool,
        score: f64,
        max_score: f64,
        explanation: &str,
    ) -> Result<QuizAttempt, String> {
        let quiz_id = quiz_id.trim().chars().take(96).collect::<String>();
        if quiz_id.is_empty() {
            return Err("Quiz id is empty.".to_string());
        }
        let quiz_type = quiz_type.trim().chars().take(48).collect::<String>();
        if quiz_type.is_empty() {
            return Err("Quiz type is empty.".to_string());
        }
        let answer_json = answer_json.trim();
        if answer_json.is_empty() {
            return Err("Quiz answer is empty.".to_string());
        }

        self.conn
            .query_row(
                "SELECT 1 FROM messages
                 WHERE id = ?1 AND tree_id = ?2 AND node_id = ?3 AND role = 'assistant'",
                params![message_id, tree_id, node_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Quiz message not found.".to_string())?;

        let ts = Self::now();
        let attempt = QuizAttempt {
            id: Uuid::new_v4().to_string(),
            tree_id: tree_id.to_string(),
            node_id: node_id.to_string(),
            message_id: message_id.to_string(),
            quiz_id,
            quiz_type,
            answer_json: answer_json.to_string(),
            is_correct,
            score,
            max_score,
            explanation: explanation.trim().chars().take(4_000).collect(),
            created_at: ts,
        };
        self.conn
            .execute(
                "INSERT INTO quiz_attempts(
                    id, tree_id, node_id, message_id, quiz_id, quiz_type,
                    answer_json, is_correct, score, max_score, explanation, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    &attempt.id,
                    &attempt.tree_id,
                    &attempt.node_id,
                    &attempt.message_id,
                    &attempt.quiz_id,
                    &attempt.quiz_type,
                    &attempt.answer_json,
                    attempt.is_correct,
                    attempt.score,
                    attempt.max_score,
                    &attempt.explanation,
                    attempt.created_at
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(attempt)
    }

    pub fn get_quiz_attempts_for_path(
        &self,
        tree_id: &str,
        node_id: &str,
    ) -> Result<Vec<QuizAttempt>, String> {
        let path = self.get_path_node_ids(tree_id, node_id)?;
        if path.is_empty() {
            return Ok(Vec::new());
        }

        let placeholders = path.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT id, tree_id, node_id, message_id, quiz_id, quiz_type, answer_json,
                    is_correct, score, max_score, explanation, created_at
             FROM quiz_attempts
             WHERE tree_id = ? AND node_id IN ({placeholders})
             ORDER BY created_at, rowid"
        );
        let mut values: Vec<Box<dyn ToSql>> = vec![Box::new(tree_id.to_string())];
        for id in path {
            values.push(Box::new(id));
        }
        let params = values.iter().map(|value| value.as_ref());

        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(params), quiz_attempt_from_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn get_messages_for_path(
        &self,
        tree_id: &str,
        node_id: &str,
    ) -> Result<Vec<Message>, String> {
        let path = self.get_path_node_ids(tree_id, node_id)?;
        if path.is_empty() {
            return Ok(Vec::new());
        }

        let placeholders = path.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT id, tree_id, node_id, role, content, visualization_html, created_at
             FROM messages WHERE tree_id = ? AND node_id IN ({placeholders})
             ORDER BY created_at, rowid"
        );
        let mut values: Vec<Box<dyn ToSql>> = vec![Box::new(tree_id.to_string())];
        for id in path {
            values.push(Box::new(id));
        }
        let params = values.iter().map(|value| value.as_ref());

        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(params), |row| {
                Ok(Message {
                    id: row.get(0)?,
                    tree_id: row.get(1)?,
                    node_id: row.get(2)?,
                    role: row.get(3)?,
                    content: row.get(4)?,
                    visualization_html: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn get_messages_for_node(
        &self,
        tree_id: &str,
        node_id: &str,
    ) -> Result<Vec<Message>, String> {
        self.read_messages_for_node(tree_id, node_id, None)
    }

    fn get_recent_messages_for_node(
        &self,
        tree_id: &str,
        node_id: &str,
        limit: usize,
    ) -> Result<Vec<Message>, String> {
        self.read_messages_for_node(tree_id, node_id, Some(limit))
    }

    fn read_messages_for_node(
        &self,
        tree_id: &str,
        node_id: &str,
        limit: Option<usize>,
    ) -> Result<Vec<Message>, String> {
        self.get_node(tree_id, node_id)?;
        let mut sql = String::from(
            "SELECT id, tree_id, node_id, role, content, visualization_html, created_at
             FROM messages WHERE tree_id = ?1 AND node_id = ?2
             ORDER BY created_at DESC, rowid DESC",
        );
        if limit.is_some() {
            sql.push_str(" LIMIT ?3");
        }
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = if let Some(limit) = limit {
            stmt.query_map(params![tree_id, node_id, limit as i64], message_from_row)
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        } else {
            stmt.query_map(params![tree_id, node_id], message_from_row)
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        Ok(rows.into_iter().rev().collect())
    }

    fn get_branch_contract_message(
        &self,
        tree_id: &str,
        node_id: &str,
    ) -> Result<Option<Message>, String> {
        self.conn
            .query_row(
                "SELECT id, tree_id, node_id, role, content, visualization_html, created_at
                 FROM messages
                 WHERE tree_id = ?1
                   AND node_id = ?2
                   AND role = 'assistant'
                   AND trim(content) LIKE 'Контекст ветки:%'
                 ORDER BY created_at, rowid
                 LIMIT 1",
                params![tree_id, node_id],
                message_from_row,
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn build_api_messages_for_node(
        &self,
        tree_id: &str,
        node_id: &str,
    ) -> Result<Vec<ChatContextMessage>, String> {
        let path_nodes = self.get_path_node_context(tree_id, node_id)?;
        let path_titles = path_nodes
            .iter()
            .map(|node| node.title.clone())
            .collect::<Vec<_>>();
        let current_title = path_titles
            .last()
            .cloned()
            .unwrap_or_else(|| "current leaf".to_string());
        let breadcrumb = path_titles.join(" -> ");
        let compact_path_context = compact_path_context(&path_nodes);
        let local_context = format!(
            "Current selected tree path: {breadcrumb}\nCurrent leaf/topic: {current_title}\n{compact_path_context}\nParent branch history is cached as node summaries above; do not assume omitted parent messages are the active conversation.\nWhen the user says \"эта тема\", \"эту тему\", \"эта ветка\", \"текущий лист\", \"здесь\", \"опиши тему\", or similar deictic phrases, resolve them to the current leaf/topic and its full breadcrumb. Keep the answer scoped to this leaf unless the user explicitly asks to move up or compare sibling branches."
        );
        let mut rows =
            self.get_recent_messages_for_node(tree_id, node_id, API_CONTEXT_RECENT_MESSAGE_LIMIT)?;
        if let Some(contract) = self.get_branch_contract_message(tree_id, node_id)? {
            if !rows.iter().any(|row| row.id == contract.id) {
                rows.insert(0, contract);
            }
        }
        let latest_user_id = rows
            .iter()
            .rev()
            .find(|row| row.role == "user")
            .map(|row| row.id.clone());
        let mut messages = vec![
            ChatContextMessage {
                role: "system".to_string(),
                content: context_builder::base_assistant_prompt(),
            },
            ChatContextMessage {
                role: "system".to_string(),
                content: local_context.clone(),
            },
        ];

        for row in rows {
            if matches!(row.role.as_str(), "user" | "assistant" | "system") {
                if latest_user_id.as_deref() == Some(row.id.as_str()) {
                    let user_content =
                        compact_direct_attachment_payloads(&strip_agent_mode_marker(&row.content));
                    messages.push(ChatContextMessage {
                        role: "system".to_string(),
                        content: format!(
                            "Immediate context for the next user request:\n{local_context}\nIf the request is short or deictic, answer about \"{current_title}\" specifically, not about the broad parent/root material."
                        ),
                    });
                    let memory_context = self.memory_context_for_query(&user_content, 6)?;
                    if !memory_context.is_empty() {
                        messages.push(ChatContextMessage {
                            role: "system".to_string(),
                            content: memory_context,
                        });
                    }
                    for module in context_builder::dynamic_context_modules(
                        &user_content,
                        &current_title,
                        &breadcrumb,
                    ) {
                        messages.push(ChatContextMessage {
                            role: "system".to_string(),
                            content: module,
                        });
                    }
                    if context_builder::wants_step_graph_response(
                        &user_content,
                        &current_title,
                        &breadcrumb,
                    ) {
                        messages.push(ChatContextMessage {
                            role: "system".to_string(),
                            content: context_builder::step_graph_prompt(
                                &current_title,
                                &breadcrumb,
                                &user_content,
                            ),
                        });
                    }
                }
                let row_content = strip_agent_mode_marker(&row.content);
                let is_latest_user = latest_user_id.as_deref() == Some(row.id.as_str());
                let row_content_for_scope = compact_direct_attachment_payloads(&row_content);
                let content = if is_latest_user
                    && context_builder::is_deictic_topic_request(&row_content_for_scope)
                {
                    format!(
                        "Current selected leaf/topic: {current_title}\nFull selected path: {breadcrumb}\nUser request about this current leaf/topic: {}",
                        row_content
                    )
                } else if is_latest_user && has_direct_attachment_payload(&row_content) {
                    row_content
                } else {
                    truncate_for_api_context(&row_content_for_scope, API_CONTEXT_MESSAGE_CHAR_LIMIT)
                };
                messages.push(ChatContextMessage {
                    role: row.role,
                    content,
                });
            }
        }
        Ok(messages)
    }

    pub fn create_agent_run(
        &mut self,
        input: AgentRunInput,
        plan: AgentRunPlan,
    ) -> Result<AgentRunDetail, String> {
        let goal = clean_required_text(&input.goal, 20_000, "Goal")?;
        if let (Some(tree_id), Some(node_id)) = (input.tree_id.as_deref(), input.node_id.as_deref())
        {
            self.get_node(tree_id, node_id)?;
        }
        let title = input
            .title
            .as_deref()
            .map(|value| clean_title_or(value.to_string(), "Agent run"))
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| clean_title_or(plan.title.clone(), "Agent run"));
        let prd = clean_required_text(&plan.prd, 40_000, "PRD")?;
        let specs = normalize_specs(plan.specs);
        let mut tasks = plan
            .tasks
            .into_iter()
            .filter_map(|task| normalize_agent_task_draft(task).ok())
            .take(24)
            .collect::<Vec<_>>();
        if tasks.is_empty() {
            tasks.push(AgentTaskDraft {
                title: "Clarify next step".to_string(),
                description: "Restate the goal, identify missing context, and propose the first safe implementation step.".to_string(),
            });
        }
        let specs_json = serde_json::to_string(&specs).map_err(|e| e.to_string())?;
        let ts = Self::now();
        let run_id = Uuid::new_v4().to_string();
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO agent_runs(
                id, tree_id, node_id, title, goal, prd, specs_json, status,
                current_task_id, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', NULL, ?8, ?9)",
            params![
                run_id,
                input.tree_id.as_deref(),
                input.node_id.as_deref(),
                title,
                goal,
                prd,
                specs_json,
                ts,
                ts
            ],
        )
        .map_err(|e| e.to_string())?;
        for (index, task) in tasks.iter().enumerate() {
            tx.execute(
                "INSERT INTO agent_tasks(
                    id, run_id, position, title, description, status, result, error,
                    trace_json, created_at, updated_at, started_at, completed_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', NULL, NULL, NULL, ?6, ?7, NULL, NULL)",
                params![
                    Uuid::new_v4().to_string(),
                    run_id,
                    index as i64 + 1,
                    task.title,
                    task.description,
                    ts,
                    ts
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        self.get_agent_run(&run_id)
    }

    pub fn list_agent_runs(&self, limit: usize) -> Result<Vec<AgentRunDetail>, String> {
        let limit = limit.clamp(1, 50) as i64;
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, tree_id, node_id, title, goal, prd, specs_json, status,
                        current_task_id, created_at, updated_at
                 FROM agent_runs ORDER BY updated_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let runs = stmt
            .query_map(params![limit], agent_run_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        runs.into_iter()
            .map(|run| {
                let tasks = self.list_agent_tasks(&run.id)?;
                Ok(AgentRunDetail { run, tasks })
            })
            .collect::<Result<Vec<_>, String>>()
    }

    pub fn get_agent_run(&self, run_id: &str) -> Result<AgentRunDetail, String> {
        let run = self
            .conn
            .query_row(
                "SELECT id, tree_id, node_id, title, goal, prd, specs_json, status,
                        current_task_id, created_at, updated_at
                 FROM agent_runs WHERE id = ?1",
                params![run_id],
                agent_run_from_row,
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Agent run not found.".to_string())?;
        let tasks = self.list_agent_tasks(&run.id)?;
        Ok(AgentRunDetail { run, tasks })
    }

    pub fn start_next_agent_task(&self, run_id: &str) -> Result<Option<AgentTask>, String> {
        let detail = self.get_agent_run(run_id)?;
        if detail.run.status == "completed" || detail.run.status == "cancelled" {
            return Ok(None);
        }
        if let Some(task) = detail
            .tasks
            .iter()
            .find(|task| task.status == "in_progress")
            .cloned()
        {
            return Ok(Some(task));
        }
        let Some(task) = detail
            .tasks
            .iter()
            .find(|task| task.status == "pending")
            .cloned()
        else {
            self.mark_agent_run_completed(run_id)?;
            return Ok(None);
        };
        let ts = Self::now();
        self.conn
            .execute(
                "UPDATE agent_tasks
                 SET status = 'in_progress', started_at = COALESCE(started_at, ?1), updated_at = ?2
                 WHERE id = ?3 AND run_id = ?4",
                params![ts, ts, task.id, run_id],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "UPDATE agent_runs
                 SET status = 'active', current_task_id = ?1, updated_at = ?2
                 WHERE id = ?3",
                params![task.id, ts, run_id],
            )
            .map_err(|e| e.to_string())?;
        self.get_agent_task(&task.id)
    }

    pub fn complete_agent_task(
        &self,
        run_id: &str,
        task_id: &str,
        result: &str,
        trace_json: Option<String>,
    ) -> Result<AgentRunDetail, String> {
        let ts = Self::now();
        self.conn
            .execute(
                "UPDATE agent_tasks
                 SET status = 'done', result = ?1, error = NULL, trace_json = ?2,
                     updated_at = ?3, completed_at = ?4
                 WHERE id = ?5 AND run_id = ?6",
                params![
                    result.trim(),
                    trace_json.as_deref(),
                    ts,
                    ts,
                    task_id,
                    run_id
                ],
            )
            .map_err(|e| e.to_string())?;
        self.refresh_agent_run_after_task(run_id)
    }

    pub fn fail_agent_task(
        &self,
        run_id: &str,
        task_id: &str,
        error: &str,
    ) -> Result<AgentRunDetail, String> {
        let ts = Self::now();
        self.conn
            .execute(
                "UPDATE agent_tasks
                 SET status = 'failed', error = ?1, updated_at = ?2, completed_at = ?3
                 WHERE id = ?4 AND run_id = ?5",
                params![error.trim(), ts, ts, task_id, run_id],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "UPDATE agent_runs
                 SET status = 'blocked', current_task_id = ?1, updated_at = ?2
                 WHERE id = ?3",
                params![task_id, ts, run_id],
            )
            .map_err(|e| e.to_string())?;
        self.get_agent_run(run_id)
    }

    fn list_agent_tasks(&self, run_id: &str) -> Result<Vec<AgentTask>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, run_id, position, title, description, status, result, error,
                        trace_json, created_at, updated_at, started_at, completed_at
                 FROM agent_tasks WHERE run_id = ?1 ORDER BY position",
            )
            .map_err(|e| e.to_string())?;
        let tasks = stmt
            .query_map(params![run_id], agent_task_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(tasks)
    }

    fn get_agent_task(&self, task_id: &str) -> Result<Option<AgentTask>, String> {
        self.conn
            .query_row(
                "SELECT id, run_id, position, title, description, status, result, error,
                        trace_json, created_at, updated_at, started_at, completed_at
                 FROM agent_tasks WHERE id = ?1",
                params![task_id],
                agent_task_from_row,
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    fn mark_agent_run_completed(&self, run_id: &str) -> Result<(), String> {
        let ts = Self::now();
        self.conn
            .execute(
                "UPDATE agent_runs
                 SET status = 'completed', current_task_id = NULL, updated_at = ?1
                 WHERE id = ?2",
                params![ts, run_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn refresh_agent_run_after_task(&self, run_id: &str) -> Result<AgentRunDetail, String> {
        let pending = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM agent_tasks
                 WHERE run_id = ?1 AND status IN ('pending', 'in_progress')",
                params![run_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?;
        let failed = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM agent_tasks WHERE run_id = ?1 AND status = 'failed'",
                params![run_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?;
        let status = if pending == 0 && failed == 0 {
            "completed"
        } else if failed > 0 {
            "blocked"
        } else {
            "active"
        };
        let next_task_id = if status == "active" {
            self.conn
                .query_row(
                    "SELECT id FROM agent_tasks
                     WHERE run_id = ?1 AND status IN ('pending', 'in_progress')
                     ORDER BY CASE status WHEN 'in_progress' THEN 0 ELSE 1 END, position
                     LIMIT 1",
                    params![run_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|e| e.to_string())?
        } else {
            None
        };
        let ts = Self::now();
        self.conn
            .execute(
                "UPDATE agent_runs
                 SET status = ?1, current_task_id = ?2, updated_at = ?3
                 WHERE id = ?4",
                params![status, next_task_id.as_deref(), ts, run_id],
            )
            .map_err(|e| e.to_string())?;
        self.get_agent_run(run_id)
    }

    pub fn record_terminal_command(
        &mut self,
        result: &terminal::TerminalCommandResult,
    ) -> Result<TerminalCommandHistoryItem, String> {
        let id = Uuid::new_v4().to_string();
        let ts = Self::now();
        let reasons_json =
            serde_json::to_string(&result.safety.reasons).map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "INSERT INTO terminal_command_history(
                    id, command, cwd, approved, requires_approval, reasons_json,
                    success, exit_code, duration_ms, timed_out, diagnosis, stdout, stderr, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    id,
                    result.command,
                    result.cwd,
                    result.approved,
                    result.safety.requires_approval,
                    reasons_json,
                    result.success,
                    result.exit_code,
                    result.duration_ms as i64,
                    result.timed_out,
                    result.diagnosis,
                    result.stdout,
                    result.stderr,
                    ts
                ],
            )
            .map_err(|e| e.to_string())?;
        self.get_terminal_history_item(&id)
    }

    pub fn list_terminal_history(
        &self,
        limit: usize,
    ) -> Result<Vec<TerminalCommandHistoryItem>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, command, cwd, approved, requires_approval, reasons_json,
                        success, exit_code, duration_ms, timed_out, diagnosis, stdout, stderr, created_at
                 FROM terminal_command_history
                 ORDER BY created_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(
                params![limit.clamp(1, 100) as i64],
                terminal_history_from_row,
            )
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    fn get_terminal_history_item(&self, id: &str) -> Result<TerminalCommandHistoryItem, String> {
        self.conn
            .query_row(
                "SELECT id, command, cwd, approved, requires_approval, reasons_json,
                        success, exit_code, duration_ms, timed_out, diagnosis, stdout, stderr, created_at
                 FROM terminal_command_history WHERE id = ?1",
                params![id],
                terminal_history_from_row,
            )
            .map_err(|e| e.to_string())
    }

    pub fn add_memory(&mut self, input: MemoryInput) -> Result<MemoryItem, String> {
        let description = clean_memory_text(&input.description, 16_000, "Description")?;
        let target = clean_memory_text(&input.target, 4096, "Target")?;
        let source_type = input
            .source_type
            .as_deref()
            .map(clean_memory_kind)
            .unwrap_or_else(|| infer_memory_source_type(&target));
        let title = input
            .title
            .as_deref()
            .map(|value| clean_memory_title(value, &description))
            .unwrap_or_else(|| clean_memory_title("", &description));
        let tags = normalize_memory_tags(input.tags.unwrap_or_default());
        let importance = input.importance.unwrap_or(5.0).clamp(0.0, 10.0);
        let memory_kind = normalize_memory_kind(input.memory_kind.as_deref().unwrap_or("note"));
        let confidence = input.confidence.unwrap_or(0.7).clamp(0.0, 1.0);
        let stability = normalize_memory_stability(input.stability.as_deref().unwrap_or("durable"));
        let embedding_text = memory_embedding_text(&title, &description, &tags);
        let embedding_blob = local_embedding::encode(&local_embedding::embed_text(&embedding_text));
        let tags_json = serde_json::to_string(&tags).map_err(|e| e.to_string())?;
        let ts = Self::now();
        let id = Uuid::new_v4().to_string();

        self.conn
            .execute(
                "INSERT INTO memory_items(
                    id, title, description, target, source_type, tags, importance,
                    memory_kind, confidence, stability, embedding,
                    created_at, updated_at, last_accessed_at, access_count
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 0)",
                params![
                    &id,
                    &title,
                    &description,
                    &target,
                    &source_type,
                    &tags_json,
                    importance,
                    &memory_kind,
                    confidence,
                    &stability,
                    &embedding_blob,
                    ts,
                    ts,
                    ts
                ],
            )
            .map_err(|e| e.to_string())?;
        self.rebuild_memory_links_for(&id)?;
        self.memory_item_by_id(&id)
    }

    pub fn update_memory(&mut self, id: &str, input: MemoryInput) -> Result<MemoryItem, String> {
        self.memory_item_by_id(id)?;
        let description = clean_memory_text(&input.description, 16_000, "Description")?;
        let target = clean_memory_text(&input.target, 4096, "Target")?;
        let source_type = input
            .source_type
            .as_deref()
            .map(clean_memory_kind)
            .unwrap_or_else(|| infer_memory_source_type(&target));
        let title = input
            .title
            .as_deref()
            .map(|value| clean_memory_title(value, &description))
            .unwrap_or_else(|| clean_memory_title("", &description));
        let tags = normalize_memory_tags(input.tags.unwrap_or_default());
        let importance = input.importance.unwrap_or(5.0).clamp(0.0, 10.0);
        let memory_kind = normalize_memory_kind(input.memory_kind.as_deref().unwrap_or("note"));
        let confidence = input.confidence.unwrap_or(0.7).clamp(0.0, 1.0);
        let stability = normalize_memory_stability(input.stability.as_deref().unwrap_or("durable"));
        let embedding_text = memory_embedding_text(&title, &description, &tags);
        let embedding_blob = local_embedding::encode(&local_embedding::embed_text(&embedding_text));
        let tags_json = serde_json::to_string(&tags).map_err(|e| e.to_string())?;
        let ts = Self::now();

        self.conn
            .execute(
                "UPDATE memory_items
                 SET title = ?1, description = ?2, target = ?3, source_type = ?4,
                     tags = ?5, importance = ?6, memory_kind = ?7, confidence = ?8,
                     stability = ?9, embedding = ?10, updated_at = ?11
                 WHERE id = ?12",
                params![
                    &title,
                    &description,
                    &target,
                    &source_type,
                    &tags_json,
                    importance,
                    &memory_kind,
                    confidence,
                    &stability,
                    &embedding_blob,
                    ts,
                    id
                ],
            )
            .map_err(|e| e.to_string())?;
        self.rebuild_memory_links_for(id)?;
        self.memory_item_by_id(id)
    }

    pub fn merge_memory(&mut self, keep_id: &str, remove_id: &str) -> Result<MemoryItem, String> {
        if keep_id == remove_id {
            return Err("Cannot merge a memory item into itself.".to_string());
        }
        let keep = self.memory_item_by_id(keep_id)?;
        let remove = self.memory_item_by_id(remove_id)?;
        let description = merge_memory_descriptions(&keep.description, &remove.description);
        let mut tags = keep.tags.clone();
        tags.extend(remove.tags);
        let memory_kind = if keep.memory_kind == "note" && remove.memory_kind != "note" {
            remove.memory_kind
        } else {
            keep.memory_kind
        };
        let input = MemoryInput {
            title: Some(keep.title),
            description,
            target: keep.target,
            source_type: Some(keep.source_type),
            tags: Some(tags),
            importance: Some(keep.importance.max(remove.importance)),
            memory_kind: Some(memory_kind),
            confidence: Some(keep.confidence.max(remove.confidence)),
            stability: Some(merge_memory_stability(&keep.stability, &remove.stability)),
        };
        let updated = self.update_memory(keep_id, input)?;
        self.delete_memory(remove_id)?;
        self.rebuild_memory_links_for(keep_id)?;
        Ok(updated)
    }

    pub fn search_memory(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<MemorySearchResult>, String> {
        self.search_memory_internal(query, limit, true)
    }

    pub fn search_memory_readonly(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<MemorySearchResult>, String> {
        self.search_memory_internal(query, limit, false)
    }

    fn search_memory_internal(
        &self,
        query: &str,
        limit: usize,
        record_access: bool,
    ) -> Result<Vec<MemorySearchResult>, String> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let query_embedding = local_embedding::embed_text(query);
        let query_tokens = local_embedding::tokenize(query);
        let feedback_scores = self.feedback_scores_for_type("memory")?;
        let mut results = self
            .memory_rows_with_embeddings()?
            .into_iter()
            .map(|(item, embedding)| {
                let vector_score = local_embedding::cosine_similarity(&query_embedding, &embedding)
                    .clamp(0.0, 1.0);
                let keyword_score = keyword_overlap_score(&query_tokens, &item);
                let importance_score = (item.importance / 10.0).clamp(0.0, 1.0);
                let access_score = ((item.access_count as f64 + 1.0).ln() / 4.0).clamp(0.0, 1.0);
                let feedback_score = feedback_scores.get(&item.id).copied().unwrap_or(0.0);
                let base_score = (0.82 * vector_score
                    + 0.10 * keyword_score
                    + 0.05 * importance_score
                    + 0.03 * access_score
                    + 0.08 * feedback_score)
                    .clamp(0.0, 1.0);
                let rerank_score = rerank_memory_score(query, &query_tokens, &item);
                let score = (0.86 * base_score + 0.14 * rerank_score).clamp(0.0, 1.0);
                MemorySearchResult {
                    item,
                    score,
                    vector_score,
                    keyword_score,
                }
            })
            .filter(|result| result.score > 0.03)
            .collect::<Vec<_>>();
        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.item.updated_at.cmp(&a.item.updated_at))
        });
        results.truncate(limit.clamp(1, 50));
        if record_access && !results.is_empty() {
            let ts = Self::now();
            for result in &results {
                self.conn
                    .execute(
                        "UPDATE memory_items
                         SET last_accessed_at = ?1, access_count = access_count + 1
                         WHERE id = ?2",
                        params![ts, &result.item.id],
                    )
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(results)
    }

    pub fn list_memory_recent(&self, limit: usize) -> Result<Vec<MemoryItem>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, title, description, target, source_type, tags, importance,
                        memory_kind, confidence, stability,
                        created_at, updated_at, last_accessed_at, access_count
                 FROM memory_items
                 ORDER BY updated_at DESC, importance DESC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit.clamp(1, 100) as i64], memory_item_from_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn memory_review_queue(&self, limit: usize) -> Result<Vec<MemoryReviewItem>, String> {
        let rows = self.memory_rows_with_embeddings()?;
        let feedback_scores = self.feedback_scores_for_type("memory")?;
        let now = Self::now();
        let mut review = Vec::new();
        let mut duplicate_items = HashSet::new();

        for i in 0..rows.len() {
            for j in (i + 1)..rows.len() {
                let (left, left_embedding) = &rows[i];
                let (right, right_embedding) = &rows[j];
                let similarity =
                    local_embedding::cosine_similarity(left_embedding, right_embedding)
                        .clamp(0.0, 1.0);
                let same_named_target = memory_review_key(&left.target)
                    == memory_review_key(&right.target)
                    && memory_review_key(&left.title) == memory_review_key(&right.title);
                if similarity < 0.92 && !same_named_target {
                    continue;
                }
                let (item, duplicate_of) = if should_review_remove(left, right) {
                    (left, right)
                } else {
                    (right, left)
                };
                if !duplicate_items.insert(item.id.clone()) {
                    continue;
                }
                review.push(MemoryReviewItem {
                    id: format!("duplicate:{}:{}", item.id, duplicate_of.id),
                    kind: "duplicate".to_string(),
                    item: item.clone(),
                    reason: format!(
                        "Likely duplicate of \"{}\" with {}% similarity.",
                        duplicate_of.title,
                        (similarity * 100.0).round() as i64
                    ),
                    score: similarity,
                    duplicate_of: Some(duplicate_of.clone()),
                    suggested_action: "merge".to_string(),
                });
            }
        }

        for (item, _) in &rows {
            if item.confidence < 0.55 {
                review.push(MemoryReviewItem {
                    id: format!("low-confidence:{}", item.id),
                    kind: "low_confidence".to_string(),
                    item: item.clone(),
                    reason: format!(
                        "Confidence is {}%, so this memory needs human review.",
                        (item.confidence * 100.0).round() as i64
                    ),
                    score: (1.0 - item.confidence).clamp(0.0, 1.0),
                    duplicate_of: None,
                    suggested_action: "review".to_string(),
                });
            }

            let age_seconds = now - item.last_accessed_at.max(item.updated_at);
            let age_days = (age_seconds.max(0) as f64 / 86_400.0).floor() as i64;
            let stale = match item.stability.as_str() {
                "temporary" => age_days >= 14,
                "durable" => age_days >= 120,
                _ => false,
            };
            if stale {
                review.push(MemoryReviewItem {
                    id: format!("stale:{}", item.id),
                    kind: "stale".to_string(),
                    item: item.clone(),
                    reason: format!(
                        "Not accessed or updated for {age_days} days; stability is {}.",
                        item.stability
                    ),
                    score: (age_days as f64 / 365.0).clamp(0.0, 1.0),
                    duplicate_of: None,
                    suggested_action: "delete_or_archive".to_string(),
                });
            }

            let feedback_score = feedback_scores.get(&item.id).copied().unwrap_or(0.0);
            if feedback_score < -0.2 {
                review.push(MemoryReviewItem {
                    id: format!("negative-feedback:{}", item.id),
                    kind: "negative_feedback".to_string(),
                    item: item.clone(),
                    reason: format!(
                        "Recent feedback is negative (score {:.2}); check whether this memory is useful.",
                        feedback_score
                    ),
                    score: feedback_score.abs().clamp(0.0, 1.0),
                    duplicate_of: None,
                    suggested_action: "review".to_string(),
                });
            }
        }

        review.sort_by(|a, b| {
            review_kind_rank(&a.kind)
                .cmp(&review_kind_rank(&b.kind))
                .then_with(|| {
                    b.score
                        .partial_cmp(&a.score)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .then_with(|| b.item.updated_at.cmp(&a.item.updated_at))
        });
        review.truncate(limit.clamp(1, 80));
        Ok(review)
    }

    pub fn export_memory_json(&self) -> Result<String, String> {
        let items = self
            .memory_rows_with_embeddings()?
            .into_iter()
            .map(|(item, _)| item)
            .collect::<Vec<_>>();
        let export = MemoryExport {
            version: 1,
            exported_at: Self::now(),
            items,
        };
        serde_json::to_string_pretty(&export).map_err(|e| e.to_string())
    }

    pub fn import_memory_json(&mut self, raw: &str) -> Result<MemoryImportResult, String> {
        let raw = raw.trim();
        if raw.is_empty() {
            return Err("Memory import JSON is empty.".to_string());
        }
        let export = serde_json::from_str::<MemoryExport>(raw).or_else(|_| {
            serde_json::from_str::<Vec<MemoryItem>>(raw).map(|items| MemoryExport {
                version: 1,
                exported_at: Self::now(),
                items,
            })
        });
        let export = export.map_err(|e| format!("Invalid memory import JSON: {e}"))?;
        let mut result = MemoryImportResult {
            imported: 0,
            skipped: 0,
            updated: 0,
            errors: Vec::new(),
        };

        for item in export.items {
            match self.memory_exact_exists(&item.title, &item.target, &item.description) {
                Ok(true) => {
                    result.skipped += 1;
                    continue;
                }
                Ok(false) => {}
                Err(error) => {
                    result.errors.push(error);
                    continue;
                }
            }
            let input = MemoryInput {
                title: Some(item.title),
                description: item.description,
                target: item.target,
                source_type: Some(item.source_type),
                tags: Some(item.tags),
                importance: Some(item.importance),
                memory_kind: Some(item.memory_kind),
                confidence: Some(item.confidence),
                stability: Some(item.stability),
            };
            match self.add_memory(input) {
                Ok(_) => result.imported += 1,
                Err(error) => result.errors.push(error),
            }
        }
        Ok(result)
    }

    pub fn delete_memory(&mut self, id: &str) -> Result<(), String> {
        let changed = self
            .conn
            .execute("DELETE FROM memory_items WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("Memory item not found.".to_string());
        }
        Ok(())
    }

    pub fn record_feedback(&mut self, input: FeedbackInput) -> Result<(), String> {
        let target_type = normalize_feedback_target_type(&input.target_type)?;
        let target_id = clean_memory_text(&input.target_id, 256, "Feedback target id")?;
        let rating = normalize_feedback_rating(&input.rating)?;
        let target = input
            .target
            .as_deref()
            .map(|value| clean_memory_text(value, 4096, "Feedback target"))
            .transpose()?;
        let note = input
            .note
            .as_deref()
            .map(|value| clean_memory_text(value, 2048, "Feedback note"))
            .transpose()?;
        self.conn
            .execute(
                "INSERT INTO feedback_events(
                    id, target_type, target_id, target, rating, note, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    Uuid::new_v4().to_string(),
                    target_type,
                    target_id,
                    target,
                    rating,
                    note,
                    Self::now()
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn feedback_summary(&self, limit: usize) -> Result<Vec<FeedbackSummary>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT target_type,
                        SUM(CASE rating WHEN 'useful' THEN 1 ELSE 0 END) AS positive,
                        SUM(CASE rating WHEN 'not_useful' THEN 1 ELSE 0 END) AS negative,
                        COUNT(*) AS total,
                        MAX(created_at) AS latest_at
                 FROM feedback_events
                 GROUP BY target_type
                 ORDER BY latest_at DESC, total DESC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit.clamp(1, 24) as i64], |row| {
                let positive = row.get::<_, i64>(1)?;
                let negative = row.get::<_, i64>(2)?;
                let total = row.get::<_, i64>(3)?;
                let score = if total > 0 {
                    ((positive - negative) as f64 / total as f64).clamp(-1.0, 1.0)
                } else {
                    0.0
                };
                Ok(FeedbackSummary {
                    target_type: row.get(0)?,
                    positive,
                    negative,
                    total,
                    score,
                    latest_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn feedback_scores_for_type(&self, target_type: &str) -> Result<HashMap<String, f64>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT target_id,
                        SUM(CASE rating WHEN 'useful' THEN 1 WHEN 'not_useful' THEN -1 ELSE 0 END) AS vote_sum,
                        COUNT(*) AS vote_count
                 FROM feedback_events
                 WHERE target_type = ?1
                 GROUP BY target_id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![target_type], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut scores = HashMap::new();
        for row in rows {
            let (target_id, vote_sum, vote_count) = row.map_err(|e| e.to_string())?;
            let denominator = (vote_count.max(0) + 2) as f64;
            let score = (vote_sum as f64 / denominator).clamp(-1.0, 1.0);
            scores.insert(target_id, score);
        }
        Ok(scores)
    }

    pub fn memory_graph(&self, limit: usize) -> Result<MemoryGraph, String> {
        let nodes = self.list_memory_recent(limit.clamp(1, 80))?;
        let ids = nodes
            .iter()
            .map(|item| item.id.clone())
            .collect::<HashSet<_>>();
        if ids.is_empty() {
            return Ok(MemoryGraph {
                nodes,
                links: Vec::new(),
            });
        }
        let mut stmt = self
            .conn
            .prepare(
                "SELECT source_id, target_id, label, weight
                 FROM memory_links
                 ORDER BY weight DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(MemoryLink {
                    source_id: row.get(0)?,
                    target_id: row.get(1)?,
                    label: row.get(2)?,
                    weight: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let links = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|link| ids.contains(&link.source_id) && ids.contains(&link.target_id))
            .take(limit.saturating_mul(4).max(12))
            .collect();
        Ok(MemoryGraph { nodes, links })
    }

    pub fn has_memory_ingest_run(&self, fingerprint: &str) -> Result<bool, String> {
        let exists = self
            .conn
            .query_row(
                "SELECT 1 FROM memory_ingest_runs WHERE fingerprint = ?1 LIMIT 1",
                params![fingerprint],
                |_| Ok(()),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .is_some();
        Ok(exists)
    }

    pub fn mark_memory_ingest_run(
        &mut self,
        fingerprint: &str,
        source_kind: &str,
        target: &str,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT OR IGNORE INTO memory_ingest_runs(
                    fingerprint, source_kind, target, created_at
                 ) VALUES (?1, ?2, ?3, ?4)",
                params![fingerprint, source_kind, target, Self::now()],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn record_memory_decision(
        &mut self,
        fingerprint: &str,
        target: &str,
        action: &str,
        reason: &str,
        item_title: Option<&str>,
        item_description: Option<&str>,
        score: Option<f64>,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO memory_decisions(
                    id, fingerprint, target, action, reason, item_title, item_description, score, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    Uuid::new_v4().to_string(),
                    fingerprint,
                    target,
                    action,
                    reason,
                    item_title.map(|value| value.chars().take(160).collect::<String>()),
                    item_description.map(|value| value.chars().take(420).collect::<String>()),
                    score,
                    Self::now(),
                ],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "DELETE FROM memory_decisions
                 WHERE id NOT IN (
                    SELECT id FROM memory_decisions ORDER BY created_at DESC LIMIT 240
                 )",
                [],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_memory_decisions(&self, limit: usize) -> Result<Vec<MemoryDecision>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, fingerprint, target, action, reason, item_title, item_description, score, created_at
                 FROM memory_decisions
                 ORDER BY created_at DESC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit.clamp(1, 80) as i64], |row| {
                Ok(MemoryDecision {
                    id: row.get(0)?,
                    fingerprint: row.get(1)?,
                    target: row.get(2)?,
                    action: row.get(3)?,
                    reason: row.get(4)?,
                    item_title: row.get(5)?,
                    item_description: row.get(6)?,
                    score: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn prepare_knowledge_source(
        &mut self,
        input: KnowledgeSourceInput,
    ) -> Result<(KnowledgeSource, bool), String> {
        let path = clean_memory_text(&input.path, 4096, "Knowledge source path")?;
        let title = clean_memory_title(&input.title, &path);
        let source_type = clean_memory_kind(&input.source_type);
        let fingerprint = clean_memory_text(&input.fingerprint, 256, "Knowledge fingerprint")?;
        let existing = self.knowledge_source_by_path(&path)?;
        let ts = Self::now();

        if let Some(source) = existing {
            let has_chunks = self
                .conn
                .query_row(
                    "SELECT 1 FROM knowledge_chunks WHERE source_id = ?1 LIMIT 1",
                    params![&source.id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .is_some();
            if source.fingerprint == fingerprint && has_chunks {
                return Ok((source, false));
            }
            self.conn
                .execute(
                    "DELETE FROM knowledge_chunks WHERE source_id = ?1",
                    params![&source.id],
                )
                .map_err(|e| e.to_string())?;
            self.delete_knowledge_fts_for_source(&source.id)?;
            self.conn
                .execute(
                    "UPDATE knowledge_sources
                     SET title = ?1, source_type = ?2, fingerprint = ?3, bytes = ?4,
                         modified_at = ?5, updated_at = ?6, last_indexed_at = ?7
                     WHERE id = ?8",
                    params![
                        &title,
                        &source_type,
                        &fingerprint,
                        input.bytes.max(0),
                        input.modified_at.max(0),
                        ts,
                        ts,
                        &source.id
                    ],
                )
                .map_err(|e| e.to_string())?;
            return Ok((self.knowledge_source_by_id(&source.id)?, true));
        }

        let id = Uuid::new_v4().to_string();
        self.conn
            .execute(
                "INSERT INTO knowledge_sources(
                    id, path, title, source_type, fingerprint, bytes,
                    modified_at, created_at, updated_at, last_indexed_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    &id,
                    &path,
                    &title,
                    &source_type,
                    &fingerprint,
                    input.bytes.max(0),
                    input.modified_at.max(0),
                    ts,
                    ts,
                    ts
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok((self.knowledge_source_by_id(&id)?, true))
    }

    pub fn add_knowledge_chunk(
        &mut self,
        input: KnowledgeChunkInput,
    ) -> Result<KnowledgeChunk, String> {
        let text = clean_memory_text(&input.text, 24_000, "Knowledge chunk")?;
        let target = clean_memory_text(&input.target, 4096, "Knowledge target")?;
        let fingerprint =
            clean_memory_text(&input.fingerprint, 256, "Knowledge chunk fingerprint")?;
        let embedding_blob =
            local_embedding::encode(&local_embedding::embed_text(&format!("{target}\n{text}")));
        let ts = Self::now();
        let id = Uuid::new_v4().to_string();
        self.conn
            .execute(
                "INSERT OR IGNORE INTO knowledge_chunks(
                    id, source_id, chunk_index, text, target, page, start_offset, end_offset,
                    fingerprint, embedding, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    &id,
                    &input.source_id,
                    input.chunk_index,
                    &text,
                    &target,
                    input.page,
                    input.start_offset.max(0),
                    input.end_offset.max(input.start_offset),
                    &fingerprint,
                    &embedding_blob,
                    ts,
                    ts
                ],
            )
            .map_err(|e| e.to_string())?;
        let chunk = self.knowledge_chunk_by_source_fingerprint(&input.source_id, &fingerprint)?;
        let source = self.knowledge_source_by_id(&chunk.source_id)?;
        self.upsert_knowledge_fts(&source, &chunk)?;
        Ok(chunk)
    }

    pub fn search_knowledge(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<KnowledgeSearchResult>, String> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let query_embedding = local_embedding::embed_text(query);
        let query_tokens = local_embedding::tokenize(query);
        let fts_scores = self.knowledge_fts_scores(query, limit.saturating_mul(4).max(20))?;
        let feedback_scores = self.feedback_scores_for_type("knowledge_chunk")?;
        let now = Self::now();
        let mut results = self
            .knowledge_rows_with_embeddings()?
            .into_iter()
            .map(|(source, chunk, embedding)| {
                let vector_score = local_embedding::cosine_similarity(&query_embedding, &embedding)
                    .clamp(0.0, 1.0);
                let lexical_score = fts_scores
                    .get(&chunk.id)
                    .copied()
                    .unwrap_or_else(|| {
                        keyword_overlap_score_for_knowledge(&query_tokens, &source, &chunk)
                    })
                    .clamp(0.0, 1.0);
                let keyword_score =
                    keyword_overlap_score_for_knowledge(&query_tokens, &source, &chunk);
                let age_days = ((now - source.updated_at).max(0) as f64) / 86_400.0;
                let recency_score = (1.0 / (1.0 + age_days / 30.0)).clamp(0.0, 1.0);
                let feedback_score = feedback_scores.get(&chunk.id).copied().unwrap_or(0.0);
                let base_score = (0.62 * vector_score
                    + 0.28 * lexical_score
                    + 0.05 * keyword_score
                    + 0.05 * recency_score
                    + 0.08 * feedback_score)
                    .clamp(0.0, 1.0);
                let rerank_score = rerank_knowledge_score(query, &query_tokens, &source, &chunk);
                let score = (0.84 * base_score + 0.16 * rerank_score).clamp(0.0, 1.0);
                KnowledgeSearchResult {
                    chunk,
                    source,
                    score,
                    vector_score,
                    keyword_score,
                }
            })
            .filter(|result| result.score > 0.03)
            .collect::<Vec<_>>();
        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.chunk.updated_at.cmp(&a.chunk.updated_at))
        });
        results.truncate(limit.clamp(1, 50));
        Ok(results)
    }

    pub fn memory_context_for_query(&self, query: &str, limit: usize) -> Result<String, String> {
        let (results, related, knowledge_results) =
            self.retrieval_parts_for_query(query, limit, true)?;
        if results.is_empty() && knowledge_results.is_empty() {
            return Ok(String::new());
        }

        Ok(crate::retrieval_context::build_retrieval_context(
            &results,
            &related,
            &knowledge_results,
        ))
    }

    pub fn retrieval_trace_for_query(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<RetrievalTrace, String> {
        let (memory_results, related_memory, knowledge_results) =
            self.retrieval_parts_for_query(query, limit, false)?;
        Ok(crate::retrieval_context::build_retrieval_trace(
            query,
            memory_results,
            related_memory,
            knowledge_results,
        ))
    }

    fn retrieval_parts_for_query(
        &self,
        query: &str,
        limit: usize,
        track_access: bool,
    ) -> Result<
        (
            Vec<MemorySearchResult>,
            Vec<(MemoryItem, String, f64)>,
            Vec<KnowledgeSearchResult>,
        ),
        String,
    > {
        let results = self.search_memory_internal(query, limit, track_access)?;
        let knowledge_results = self.search_knowledge(query, limit)?;
        let base_ids = results
            .iter()
            .map(|result| result.item.id.clone())
            .collect::<HashSet<_>>();
        let mut related = Vec::new();
        let mut seen_related = base_ids.clone();
        for id in &base_ids {
            let mut stmt = self
                .conn
                .prepare(
                    "SELECT
                        CASE WHEN source_id = ?1 THEN target_id ELSE source_id END AS related_id,
                        label,
                        weight
                     FROM memory_links
                     WHERE source_id = ?1 OR target_id = ?1
                     ORDER BY weight DESC
                     LIMIT 3",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, f64>(2)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                let (related_id, label, weight) = row.map_err(|e| e.to_string())?;
                if !seen_related.insert(related_id.clone()) {
                    continue;
                }
                if let Ok(item) = self.memory_item_by_id(&related_id) {
                    related.push((item, label, weight));
                }
            }
        }
        related.sort_by(|a, b| {
            b.2.partial_cmp(&a.2)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.0.updated_at.cmp(&a.0.updated_at))
        });
        related.truncate(limit.min(8));
        Ok((results, related, knowledge_results))
    }

    fn memory_item_by_id(&self, id: &str) -> Result<MemoryItem, String> {
        self.conn
            .query_row(
                "SELECT id, title, description, target, source_type, tags, importance,
                        memory_kind, confidence, stability,
                        created_at, updated_at, last_accessed_at, access_count
                 FROM memory_items WHERE id = ?1",
                params![id],
                memory_item_from_row,
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Memory item not found.".to_string())
    }

    fn memory_exact_exists(
        &self,
        title: &str,
        target: &str,
        description: &str,
    ) -> Result<bool, String> {
        let exists = self
            .conn
            .query_row(
                "SELECT 1 FROM memory_items
                 WHERE title = ?1 AND target = ?2 AND description = ?3
                 LIMIT 1",
                params![title, target, description],
                |_| Ok(()),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .is_some();
        Ok(exists)
    }

    fn knowledge_source_by_id(&self, id: &str) -> Result<KnowledgeSource, String> {
        self.conn
            .query_row(
                "SELECT id, path, title, source_type, fingerprint, bytes, modified_at,
                        created_at, updated_at, last_indexed_at
                 FROM knowledge_sources WHERE id = ?1",
                params![id],
                knowledge_source_from_row,
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Knowledge source not found.".to_string())
    }

    fn knowledge_source_by_path(&self, path: &str) -> Result<Option<KnowledgeSource>, String> {
        self.conn
            .query_row(
                "SELECT id, path, title, source_type, fingerprint, bytes, modified_at,
                        created_at, updated_at, last_indexed_at
                 FROM knowledge_sources WHERE path = ?1",
                params![path],
                knowledge_source_from_row,
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    fn knowledge_chunk_by_source_fingerprint(
        &self,
        source_id: &str,
        fingerprint: &str,
    ) -> Result<KnowledgeChunk, String> {
        self.conn
            .query_row(
                "SELECT id, source_id, chunk_index, text, target, page, start_offset,
                        end_offset, fingerprint, created_at, updated_at
                 FROM knowledge_chunks WHERE source_id = ?1 AND fingerprint = ?2",
                params![source_id, fingerprint],
                knowledge_chunk_from_row,
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Knowledge chunk not found.".to_string())
    }

    fn memory_rows_with_embeddings(&self) -> Result<Vec<(MemoryItem, Vec<f32>)>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, title, description, target, source_type, tags, importance,
                        memory_kind, confidence, stability,
                        created_at, updated_at, last_accessed_at, access_count, embedding
                 FROM memory_items",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let item = memory_item_from_row(row)?;
                let blob: Vec<u8> = row.get(14)?;
                Ok((item, local_embedding::decode(&blob)))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn knowledge_rows_with_embeddings(
        &self,
    ) -> Result<Vec<(KnowledgeSource, KnowledgeChunk, Vec<f32>)>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT
                    s.id, s.path, s.title, s.source_type, s.fingerprint, s.bytes,
                    s.modified_at, s.created_at, s.updated_at, s.last_indexed_at,
                    c.id, c.source_id, c.chunk_index, c.text, c.target, c.page,
                    c.start_offset, c.end_offset, c.fingerprint, c.created_at, c.updated_at,
                    c.embedding
                 FROM knowledge_chunks c
                 JOIN knowledge_sources s ON s.id = c.source_id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let source = KnowledgeSource {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    title: row.get(2)?,
                    source_type: row.get(3)?,
                    fingerprint: row.get(4)?,
                    bytes: row.get(5)?,
                    modified_at: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    last_indexed_at: row.get(9)?,
                };
                let chunk = KnowledgeChunk {
                    id: row.get(10)?,
                    source_id: row.get(11)?,
                    chunk_index: row.get(12)?,
                    text: row.get(13)?,
                    target: row.get(14)?,
                    page: row.get(15)?,
                    start_offset: row.get(16)?,
                    end_offset: row.get(17)?,
                    fingerprint: row.get(18)?,
                    created_at: row.get(19)?,
                    updated_at: row.get(20)?,
                };
                let blob: Vec<u8> = row.get(21)?;
                Ok((source, chunk, local_embedding::decode(&blob)))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn rebuild_knowledge_fts(&self) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM knowledge_chunks_fts", [])
            .map_err(|e| e.to_string())?;
        for (source, chunk, _) in self.knowledge_rows_with_embeddings()? {
            self.upsert_knowledge_fts(&source, &chunk)?;
        }
        Ok(())
    }

    fn upsert_knowledge_fts(
        &self,
        source: &KnowledgeSource,
        chunk: &KnowledgeChunk,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM knowledge_chunks_fts WHERE chunk_id = ?1",
                params![&chunk.id],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "INSERT INTO knowledge_chunks_fts(
                    chunk_id, source_id, text, target, source_title, source_path
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    &chunk.id,
                    &chunk.source_id,
                    &chunk.text,
                    &chunk.target,
                    &source.title,
                    &source.path
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn delete_knowledge_fts_for_source(&self, source_id: &str) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM knowledge_chunks_fts WHERE source_id = ?1",
                params![source_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn knowledge_fts_scores(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<HashMap<String, f64>, String> {
        let Some(fts_query) = fts_query_from_text(query) else {
            return Ok(HashMap::new());
        };
        let mut stmt = self
            .conn
            .prepare(
                "SELECT chunk_id
                 FROM knowledge_chunks_fts
                 WHERE knowledge_chunks_fts MATCH ?1
                 ORDER BY bm25(knowledge_chunks_fts)
                 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![fts_query, limit.clamp(1, 200) as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?;
        let mut scores = HashMap::new();
        for (index, row) in rows.enumerate() {
            let id = row.map_err(|e| e.to_string())?;
            let score = 1.0 / (1.0 + index as f64);
            scores.entry(id).or_insert(score);
        }
        Ok(scores)
    }

    fn rebuild_memory_links_for(&mut self, id: &str) -> Result<(), String> {
        let rows = self.memory_rows_with_embeddings()?;
        let Some((item, embedding)) = rows.iter().find(|(item, _)| item.id == id) else {
            return Ok(());
        };
        let mut related = rows
            .iter()
            .filter(|(other, _)| other.id != id)
            .map(|(other, other_embedding)| {
                (
                    other.id.clone(),
                    local_embedding::cosine_similarity(embedding, other_embedding),
                )
            })
            .filter(|(_, score)| *score >= 0.18)
            .collect::<Vec<_>>();
        related.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        related.truncate(MEMORY_GRAPH_LINK_LIMIT);

        self.conn
            .execute(
                "DELETE FROM memory_links WHERE source_id = ?1 OR target_id = ?1",
                params![id],
            )
            .map_err(|e| e.to_string())?;
        let ts = Self::now();
        for (other_id, weight) in related {
            self.conn
                .execute(
                    "INSERT INTO memory_links(source_id, target_id, label, weight, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(source_id, target_id)
                     DO UPDATE SET weight = excluded.weight, label = excluded.label",
                    params![&item.id, &other_id, "similar", weight, ts],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn layout_tree(&self, tree_id: &str) -> Result<Vec<LayoutNode>, String> {
        let nodes = self.get_nodes(tree_id)?;
        let current = self
            .conn
            .query_row(
                "SELECT last_node_id FROM trees WHERE id = ?1",
                params![tree_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten()
            .unwrap_or_default();

        let mut children: HashMap<Option<String>, Vec<&Node>> = HashMap::new();
        for node in &nodes {
            children
                .entry(node.parent_id.clone())
                .or_default()
                .push(node);
        }
        for list in children.values_mut() {
            list.sort_by_key(|node| node.created_at);
        }

        let root = nodes
            .iter()
            .find(|node| node.parent_id.is_none())
            .ok_or_else(|| "No root".to_string())?;
        let leaf_gap = 285.0;
        let level_gap = 185.0;
        let mut positions: HashMap<String, (f64, f64)> = HashMap::new();
        let mut next_leaf_x = 0.0;

        fn layout_subtree(
            node: &Node,
            depth: f64,
            children: &HashMap<Option<String>, Vec<&Node>>,
            positions: &mut HashMap<String, (f64, f64)>,
            next_leaf_x: &mut f64,
            leaf_gap: f64,
            level_gap: f64,
        ) -> f64 {
            let node_children = children
                .get(&Some(node.id.clone()))
                .cloned()
                .unwrap_or_default();
            let x = if node_children.is_empty() {
                let x = *next_leaf_x * leaf_gap;
                *next_leaf_x += 1.0;
                x
            } else {
                let child_xs = node_children
                    .iter()
                    .map(|child| {
                        layout_subtree(
                            child,
                            depth + 1.0,
                            children,
                            positions,
                            next_leaf_x,
                            leaf_gap,
                            level_gap,
                        )
                    })
                    .collect::<Vec<_>>();
                let min_x = child_xs.iter().copied().fold(f64::INFINITY, f64::min);
                let max_x = child_xs.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                (min_x + max_x) / 2.0
            };
            positions.insert(node.id.clone(), (x, depth * level_gap));
            x
        }

        layout_subtree(
            root,
            0.0,
            &children,
            &mut positions,
            &mut next_leaf_x,
            leaf_gap,
            level_gap,
        );

        Ok(nodes
            .iter()
            .filter_map(|node| {
                positions.get(&node.id).map(|(x, y)| LayoutNode {
                    id: node.id.clone(),
                    parent_id: node.parent_id.clone(),
                    title: node.title.clone(),
                    summary: node.summary.clone(),
                    color: node.color.clone(),
                    x: *x,
                    y: *y,
                    selected: node.id == current,
                    is_leaf: children
                        .get(&Some(node.id.clone()))
                        .map(|items| items.is_empty())
                        .unwrap_or(true),
                })
            })
            .collect())
    }

    pub fn get_settings(&self) -> Result<ChatSettings, String> {
        let theme = self.get_setting("theme", DEFAULT_THEME)?;
        let language = self.get_setting("language", DEFAULT_LANGUAGE)?;
        Ok(ChatSettings {
            endpoint: self.get_setting("endpoint", DEFAULT_ENDPOINT)?,
            model: self.get_setting("model", DEFAULT_MODEL)?,
            api_key: self.get_setting("api_key", "")?,
            theme: normalize_theme(&theme).to_string(),
            language: normalize_language(&language).to_string(),
        })
    }

    pub fn save_settings(&self, input: SettingsInput) -> Result<ChatSettings, String> {
        let endpoint = if input.endpoint.trim().is_empty() {
            DEFAULT_ENDPOINT
        } else {
            input.endpoint.trim()
        };
        let model = if input.model.trim().is_empty() {
            DEFAULT_MODEL
        } else {
            input.model.trim()
        };
        let theme = normalize_theme(&input.theme);
        let language = normalize_language(&input.language);
        self.set_setting("endpoint", endpoint)?;
        self.set_setting("model", model)?;
        self.set_setting("api_key", input.api_key.trim())?;
        self.set_setting("theme", theme)?;
        self.set_setting("language", language)?;
        self.get_settings()
    }

    fn get_path_node_ids(&self, tree_id: &str, node_id: &str) -> Result<Vec<String>, String> {
        let mut result = Vec::new();
        let mut current = Some(node_id.to_string());
        while let Some(id) = current {
            let (parent_id, this_id) = self
                .conn
                .query_row(
                    "SELECT parent_id, id FROM nodes WHERE tree_id = ?1 AND id = ?2",
                    params![tree_id, id],
                    |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
                )
                .map_err(|e| e.to_string())?;
            result.push(this_id);
            current = parent_id;
        }
        result.reverse();
        Ok(result)
    }

    fn get_path_node_context(
        &self,
        tree_id: &str,
        node_id: &str,
    ) -> Result<Vec<PathContextNode>, String> {
        let ids = self.get_path_node_ids(tree_id, node_id)?;
        let mut nodes = Vec::new();
        for id in ids {
            let node = self
                .conn
                .query_row(
                    "SELECT title, summary FROM nodes WHERE tree_id = ?1 AND id = ?2",
                    params![tree_id, id],
                    |row| {
                        Ok(PathContextNode {
                            title: row.get(0)?,
                            summary: row.get(1)?,
                        })
                    },
                )
                .map_err(|e| e.to_string())?;
            nodes.push(node);
        }
        Ok(nodes)
    }

    fn node_title_summary(&self, node_id: &str) -> Result<(String, Option<String>), String> {
        self.conn
            .query_row(
                "SELECT title, summary FROM nodes WHERE id = ?1",
                params![node_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| e.to_string())
    }
}

fn insert_message_tx(
    tx: &Transaction<'_>,
    tree_id: &str,
    node_id: &str,
    role: &str,
    content: &str,
    visualization_html: Option<&str>,
) -> Result<Message, String> {
    let content = content.trim();
    if content.is_empty() {
        return Err("Message is empty.".into());
    }

    let ts = Store::now();
    let message_id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO messages(id, tree_id, node_id, role, content, visualization_html, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            message_id,
            tree_id,
            node_id,
            role,
            content,
            visualization_html,
            ts
        ],
    )
    .map_err(|e| e.to_string())?;

    let (title, summary) = tx
        .query_row(
            "SELECT title, summary FROM nodes WHERE id = ?1 AND tree_id = ?2",
            params![node_id, tree_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let snippet = first_line(content).chars().take(46).collect::<String>();
    if role == "user" && (title == "Root" || title == "New node") {
        tx.execute(
            "UPDATE nodes SET title = ?1, summary = ?2, updated_at = ?3
             WHERE id = ?4 AND tree_id = ?5",
            params![snippet, snippet, ts, node_id, tree_id],
        )
        .map_err(|e| e.to_string())?;
    } else if role == "assistant"
        && (summary.is_none()
            || summary.as_deref() == Some("Empty")
            || summary.as_deref() == Some(""))
    {
        tx.execute(
            "UPDATE nodes SET summary = ?1, updated_at = ?2 WHERE id = ?3 AND tree_id = ?4",
            params![snippet, ts, node_id, tree_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        tx.execute(
            "UPDATE nodes SET updated_at = ?1 WHERE id = ?2 AND tree_id = ?3",
            params![ts, node_id, tree_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(Message {
        id: message_id,
        tree_id: tree_id.to_string(),
        node_id: node_id.to_string(),
        role: role.to_string(),
        content: content.to_string(),
        visualization_html: visualization_html.map(str::to_string),
        created_at: ts,
    })
}

fn message_from_row(row: &Row<'_>) -> rusqlite::Result<Message> {
    Ok(Message {
        id: row.get(0)?,
        tree_id: row.get(1)?,
        node_id: row.get(2)?,
        role: row.get(3)?,
        content: row.get(4)?,
        visualization_html: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn quiz_attempt_from_row(row: &Row<'_>) -> rusqlite::Result<QuizAttempt> {
    Ok(QuizAttempt {
        id: row.get(0)?,
        tree_id: row.get(1)?,
        node_id: row.get(2)?,
        message_id: row.get(3)?,
        quiz_id: row.get(4)?,
        quiz_type: row.get(5)?,
        answer_json: row.get(6)?,
        is_correct: row.get(7)?,
        score: row.get(8)?,
        max_score: row.get(9)?,
        explanation: row.get(10)?,
        created_at: row.get(11)?,
    })
}

fn agent_run_from_row(row: &Row<'_>) -> rusqlite::Result<AgentRun> {
    let specs_json: String = row.get(6)?;
    let specs = serde_json::from_str::<Vec<String>>(&specs_json).unwrap_or_default();
    Ok(AgentRun {
        id: row.get(0)?,
        tree_id: row.get(1)?,
        node_id: row.get(2)?,
        title: row.get(3)?,
        goal: row.get(4)?,
        prd: row.get(5)?,
        specs,
        status: row.get(7)?,
        current_task_id: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn agent_task_from_row(row: &Row<'_>) -> rusqlite::Result<AgentTask> {
    Ok(AgentTask {
        id: row.get(0)?,
        run_id: row.get(1)?,
        position: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        status: row.get(5)?,
        result: row.get(6)?,
        error: row.get(7)?,
        trace_json: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        started_at: row.get(11)?,
        completed_at: row.get(12)?,
    })
}

fn terminal_history_from_row(row: &Row<'_>) -> rusqlite::Result<TerminalCommandHistoryItem> {
    let reasons_json: String = row.get(5)?;
    let reasons = serde_json::from_str::<Vec<String>>(&reasons_json).unwrap_or_default();
    Ok(TerminalCommandHistoryItem {
        id: row.get(0)?,
        command: row.get(1)?,
        cwd: row.get(2)?,
        approved: row.get(3)?,
        requires_approval: row.get(4)?,
        reasons,
        success: row.get(6)?,
        exit_code: row.get(7)?,
        duration_ms: row.get(8)?,
        timed_out: row.get(9)?,
        diagnosis: row.get(10)?,
        stdout: row.get(11)?,
        stderr: row.get(12)?,
        created_at: row.get(13)?,
    })
}

fn compact_path_context(nodes: &[PathContextNode]) -> String {
    let mut lines = vec!["Cached path context (node summaries, root to leaf):".to_string()];
    for (index, node) in nodes.iter().enumerate() {
        let summary = node
            .summary
            .as_deref()
            .map(str::trim)
            .filter(|summary| !summary.is_empty() && *summary != "Empty")
            .unwrap_or("No cached summary yet");
        lines.push(format!(
            "- {}. {}: {}",
            index + 1,
            truncate_for_api_context(&node.title, 96),
            truncate_for_api_context(summary, API_CONTEXT_SUMMARY_CHAR_LIMIT)
        ));
    }
    lines.join("\n")
}

fn truncate_for_api_context(value: &str, max_chars: usize) -> String {
    let value = value.trim();
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut truncated = value
        .chars()
        .take(max_chars.saturating_sub(3))
        .collect::<String>();
    truncated.push_str("...");
    truncated
}

fn has_direct_attachment_payload(value: &str) -> bool {
    value.contains(DIRECT_ATTACHMENT_FENCE)
}

fn compact_direct_attachment_payloads(value: &str) -> String {
    let mut out = String::new();
    let mut cursor = 0;

    while let Some(relative_start) = value[cursor..].find("[Attached file: ") {
        let start = cursor + relative_start;
        let Some(relative_fence_start) = value[start..].find(DIRECT_ATTACHMENT_FENCE) else {
            break;
        };
        let fence_start = start + relative_fence_start;
        let payload_start = fence_start + DIRECT_ATTACHMENT_FENCE.len();
        let Some(relative_payload_end) = value[payload_start..].find("\n```") else {
            break;
        };
        let payload_end = payload_start + relative_payload_end;
        let block_end = payload_end + "\n```".len();

        out.push_str(&value[cursor..start]);
        let descriptor = value[start + "[Attached file: ".len()..fence_start]
            .trim()
            .trim_end_matches(']')
            .trim();
        if descriptor.is_empty() {
            out.push_str("[Attached file: bytes omitted from older context]\n");
        } else {
            out.push_str("[Attached file: ");
            out.push_str(descriptor);
            out.push_str("]\n[File bytes omitted from older context. Use the prior assistant answer unless the user re-attaches the file.]\n");
        }

        cursor = block_end;
    }

    out.push_str(&value[cursor..]);
    out.trim().to_string()
}

fn branch_context_message(parent_title: &str, item: &BranchPlanItem) -> String {
    format!(
        "Контекст ветки: {}\n\nЭта ветка создана как отдельное направление внутри родительской ветки \"{}\".\n\nЧто здесь рассматриваем: {}\n\nПродолжай диалог в этой ветке, удерживая фокус именно на этом направлении и опираясь на общий контекст родительской ветки.",
        item.title, parent_title, item.context
    )
}

fn clean_node_summary(context: &str, fallback_title: &str) -> String {
    let summary = context
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or(fallback_title)
        .chars()
        .take(220)
        .collect::<String>();
    if summary.trim().is_empty() {
        fallback_title.to_string()
    } else {
        summary
    }
}

fn normalize_node_color(color: Option<String>) -> Result<Option<String>, String> {
    let Some(color) = color else {
        return Ok(None);
    };
    let color = color.trim().to_lowercase();
    if color.is_empty() || color == "none" || color == "clear" {
        return Ok(None);
    }
    if NODE_COLORS.contains(&color.as_str()) {
        Ok(Some(color))
    } else {
        Err("Unknown node color.".to_string())
    }
}

fn clean_title_or(value: String, fallback: &str) -> String {
    let title = value.trim().chars().take(96).collect::<String>();
    if title.is_empty() {
        fallback.to_string()
    } else {
        title
    }
}

fn clean_required_text(value: &str, limit: usize, label: &str) -> Result<String, String> {
    let cleaned = value.trim().chars().take(limit).collect::<String>();
    if cleaned.trim().is_empty() {
        return Err(format!("{label} is empty."));
    }
    Ok(cleaned)
}

fn normalize_specs(specs: Vec<String>) -> Vec<String> {
    let mut normalized = specs
        .into_iter()
        .map(|spec| spec.trim().chars().take(1200).collect::<String>())
        .filter(|spec| !spec.is_empty())
        .take(16)
        .collect::<Vec<_>>();
    if normalized.is_empty() {
        normalized.push("Deliver the goal through small, verifiable tasks.".to_string());
    }
    normalized
}

fn normalize_agent_task_draft(task: AgentTaskDraft) -> Result<AgentTaskDraft, String> {
    let title = clean_title_or(task.title, "Atomic task");
    let description = clean_required_text(&task.description, 4000, "Task description")?;
    Ok(AgentTaskDraft { title, description })
}

fn strip_agent_mode_marker(value: &str) -> String {
    value
        .lines()
        .filter(|line| !line.trim().starts_with("<!-- ino-agent:mode="))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn memory_item_from_row(row: &Row<'_>) -> rusqlite::Result<MemoryItem> {
    let tags_json: String = row.get(5)?;
    let tags = serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default();
    Ok(MemoryItem {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        target: row.get(3)?,
        source_type: row.get(4)?,
        tags,
        importance: row.get(6)?,
        memory_kind: row.get(7)?,
        confidence: row.get(8)?,
        stability: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        last_accessed_at: row.get(12)?,
        access_count: row.get(13)?,
    })
}

fn knowledge_source_from_row(row: &Row<'_>) -> rusqlite::Result<KnowledgeSource> {
    Ok(KnowledgeSource {
        id: row.get(0)?,
        path: row.get(1)?,
        title: row.get(2)?,
        source_type: row.get(3)?,
        fingerprint: row.get(4)?,
        bytes: row.get(5)?,
        modified_at: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        last_indexed_at: row.get(9)?,
    })
}

fn knowledge_chunk_from_row(row: &Row<'_>) -> rusqlite::Result<KnowledgeChunk> {
    Ok(KnowledgeChunk {
        id: row.get(0)?,
        source_id: row.get(1)?,
        chunk_index: row.get(2)?,
        text: row.get(3)?,
        target: row.get(4)?,
        page: row.get(5)?,
        start_offset: row.get(6)?,
        end_offset: row.get(7)?,
        fingerprint: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn clean_memory_text(value: &str, limit: usize, label: &str) -> Result<String, String> {
    let cleaned = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        return Err(format!("{label} is empty."));
    }
    Ok(cleaned.chars().take(limit).collect())
}

fn clean_memory_title(value: &str, description: &str) -> String {
    let raw = value.trim();
    let source = if raw.is_empty() { description } else { raw };
    let first = source
        .split(['.', '\n', ';'])
        .next()
        .unwrap_or(source)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let title = first.chars().take(96).collect::<String>();
    if title.trim().is_empty() {
        "Memory".to_string()
    } else {
        title
    }
}

fn clean_memory_kind(value: &str) -> String {
    let kind = value
        .trim()
        .to_lowercase()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
        .take(32)
        .collect::<String>();
    if kind.is_empty() {
        "text".to_string()
    } else {
        kind
    }
}

fn infer_memory_source_type(target: &str) -> String {
    let lower = target.to_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return "link".to_string();
    }
    if lower.starts_with("chat://") {
        return "chat".to_string();
    }
    if lower.ends_with(".pdf") {
        return "pdf".to_string();
    }
    if lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".webp")
        || lower.ends_with(".gif")
    {
        return "image".to_string();
    }
    if lower.ends_with(".rs")
        || lower.ends_with(".ts")
        || lower.ends_with(".tsx")
        || lower.ends_with(".py")
        || lower.ends_with(".cpp")
        || lower.ends_with(".hpp")
        || lower.ends_with(".js")
        || lower.ends_with(".jsx")
    {
        return "code".to_string();
    }
    if lower.contains('/') || lower.contains('\\') {
        return "file".to_string();
    }
    "text".to_string()
}

fn normalize_memory_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for tag in tags {
        let value = tag
            .trim()
            .trim_start_matches('#')
            .to_lowercase()
            .chars()
            .filter(|ch| ch.is_alphanumeric() || *ch == '_' || *ch == '-')
            .take(32)
            .collect::<String>();
        if !value.is_empty() && seen.insert(value.clone()) {
            normalized.push(value);
        }
        if normalized.len() >= 12 {
            break;
        }
    }
    normalized
}

fn normalize_memory_kind(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "fact" => "fact",
        "preference" => "preference",
        "project_decision" | "project-decision" | "decision" => "project_decision",
        "source" => "source",
        "todo" => "todo",
        "note" | "conversation_note" | "conversation-note" => "note",
        _ => "note",
    }
    .to_string()
}

fn normalize_memory_stability(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "temporary" | "temp" => "temporary",
        "permanent" => "permanent",
        "durable" | "stable" => "durable",
        _ => "durable",
    }
    .to_string()
}

fn merge_memory_descriptions(keep: &str, remove: &str) -> String {
    let keep = keep.trim();
    let remove = remove.trim();
    if keep.is_empty() {
        return remove.to_string();
    }
    if remove.is_empty() || keep.contains(remove) {
        return keep.to_string();
    }
    format!("{keep}\n\nMerged note: {remove}")
}

fn merge_memory_stability(a: &str, b: &str) -> String {
    let rank = |value: &str| match value {
        "permanent" => 3,
        "durable" => 2,
        "temporary" => 1,
        _ => 2,
    };
    if rank(a) >= rank(b) {
        normalize_memory_stability(a)
    } else {
        normalize_memory_stability(b)
    }
}

fn normalize_feedback_target_type(value: &str) -> Result<String, String> {
    match value.trim().to_lowercase().as_str() {
        "message" | "memory" | "knowledge_chunk" | "knowledge-source" | "knowledge_source"
        | "answer" => Ok(value
            .trim()
            .to_lowercase()
            .replace('-', "_")
            .replace("answer", "message")),
        _ => Err("Unsupported feedback target type.".to_string()),
    }
}

fn normalize_feedback_rating(value: &str) -> Result<String, String> {
    match value.trim().to_lowercase().as_str() {
        "useful" | "up" | "positive" | "good" => Ok("useful".to_string()),
        "not_useful" | "not-useful" | "down" | "negative" | "bad" => Ok("not_useful".to_string()),
        _ => Err("Unsupported feedback rating.".to_string()),
    }
}

fn memory_embedding_text(title: &str, description: &str, tags: &[String]) -> String {
    if tags.is_empty() {
        format!("{title}\n{description}")
    } else {
        format!("{title}\n{description}\n{}", tags.join(" "))
    }
}

fn memory_review_key(value: &str) -> String {
    let mut key = String::new();
    let mut previous_space = false;
    for ch in value.chars().flat_map(char::to_lowercase) {
        if ch.is_alphanumeric() {
            key.push(ch);
            previous_space = false;
        } else if !previous_space {
            key.push(' ');
            previous_space = true;
        }
    }
    key.trim().to_string()
}

fn should_review_remove(left: &MemoryItem, right: &MemoryItem) -> bool {
    left.confidence
        .partial_cmp(&right.confidence)
        .unwrap_or(std::cmp::Ordering::Equal)
        .then_with(|| {
            left.importance
                .partial_cmp(&right.importance)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .then_with(|| left.updated_at.cmp(&right.updated_at))
        .is_lt()
}

fn review_kind_rank(kind: &str) -> i32 {
    match kind {
        "duplicate" => 0,
        "negative_feedback" => 1,
        "low_confidence" => 2,
        "stale" => 3,
        _ => 4,
    }
}

fn fts_query_from_text(value: &str) -> Option<String> {
    let mut seen = HashSet::new();
    let tokens = local_embedding::tokenize(value)
        .into_iter()
        .filter(|token| seen.insert(token.clone()))
        .take(16)
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" OR "))
    }
}

fn keyword_overlap_score(query_tokens: &[String], item: &MemoryItem) -> f64 {
    if query_tokens.is_empty() {
        return 0.0;
    }
    let haystack = format!(
        "{} {} {} {}",
        item.title,
        item.description,
        item.target,
        item.tags.join(" ")
    )
    .to_lowercase()
    .replace('ё', "е");
    let matched = query_tokens
        .iter()
        .filter(|token| haystack.contains(token.as_str()))
        .count();
    (matched as f64 / query_tokens.len() as f64).clamp(0.0, 1.0)
}

fn keyword_overlap_score_for_knowledge(
    query_tokens: &[String],
    source: &KnowledgeSource,
    chunk: &KnowledgeChunk,
) -> f64 {
    if query_tokens.is_empty() {
        return 0.0;
    }
    let haystack = format!(
        "{} {} {} {} {}",
        source.title, source.path, source.source_type, chunk.target, chunk.text
    )
    .to_lowercase()
    .replace('ё', "е");
    let matched = query_tokens
        .iter()
        .filter(|token| haystack.contains(token.as_str()))
        .count();
    (matched as f64 / query_tokens.len() as f64).clamp(0.0, 1.0)
}

fn rerank_memory_score(query: &str, query_tokens: &[String], item: &MemoryItem) -> f64 {
    let full = normalize_search_text(&format!(
        "{} {} {} {}",
        item.title,
        item.description,
        item.target,
        item.tags.join(" ")
    ));
    let title_target = normalize_search_text(&format!("{} {}", item.title, item.target));
    let phrase = exact_phrase_score(query, &full);
    let title_target_score = exact_phrase_score(query, &title_target)
        .max(keyword_ratio_score(query_tokens, &title_target));
    let proximity = ordered_token_proximity_score(query_tokens, &full);
    (0.48 * phrase + 0.34 * title_target_score + 0.18 * proximity).clamp(0.0, 1.0)
}

fn rerank_knowledge_score(
    query: &str,
    query_tokens: &[String],
    source: &KnowledgeSource,
    chunk: &KnowledgeChunk,
) -> f64 {
    let full = normalize_search_text(&format!(
        "{} {} {} {} {}",
        source.title, source.path, source.source_type, chunk.target, chunk.text
    ));
    let title_target = normalize_search_text(&format!(
        "{} {} {}",
        source.title, source.path, chunk.target
    ));
    let phrase = exact_phrase_score(query, &full);
    let title_target_score = exact_phrase_score(query, &title_target)
        .max(keyword_ratio_score(query_tokens, &title_target));
    let proximity = ordered_token_proximity_score(query_tokens, &full);
    (0.50 * phrase + 0.30 * title_target_score + 0.20 * proximity).clamp(0.0, 1.0)
}

fn exact_phrase_score(query: &str, normalized_haystack: &str) -> f64 {
    let normalized_query = normalize_search_text(query);
    if normalized_query.chars().count() < 3 {
        return 0.0;
    }
    if normalized_haystack.contains(&normalized_query) {
        return 1.0;
    }
    let compact_query = normalized_query.replace(' ', "");
    if compact_query.chars().count() >= 4
        && normalized_haystack
            .replace(' ', "")
            .contains(&compact_query)
    {
        return 0.92;
    }
    0.0
}

fn keyword_ratio_score(query_tokens: &[String], normalized_haystack: &str) -> f64 {
    if query_tokens.is_empty() {
        return 0.0;
    }
    let matched = query_tokens
        .iter()
        .filter(|token| normalized_haystack.contains(token.as_str()))
        .count();
    (matched as f64 / query_tokens.len() as f64).clamp(0.0, 1.0)
}

fn ordered_token_proximity_score(query_tokens: &[String], normalized_haystack: &str) -> f64 {
    if query_tokens.len() < 2 {
        return keyword_ratio_score(query_tokens, normalized_haystack) * 0.5;
    }
    let mut cursor = 0usize;
    let mut first = None;
    let mut last = None;
    let mut matched = 0usize;
    for token in query_tokens.iter().take(8) {
        let Some(offset) = normalized_haystack[cursor..].find(token) else {
            continue;
        };
        let absolute = cursor + offset;
        first.get_or_insert(absolute);
        last = Some(absolute + token.len());
        cursor = absolute + token.len();
        matched += 1;
    }
    if matched == 0 {
        return 0.0;
    }
    let coverage = matched as f64 / query_tokens.len().min(8) as f64;
    let span = first
        .zip(last)
        .map(|(start, end)| end.saturating_sub(start).max(1))
        .unwrap_or(usize::MAX);
    let compactness = (1.0 / (1.0 + span as f64 / 160.0)).clamp(0.0, 1.0);
    (0.65 * coverage + 0.35 * compactness).clamp(0.0, 1.0)
}

fn normalize_search_text(value: &str) -> String {
    let mut output = String::new();
    let mut last_space = true;
    for ch in value.to_lowercase().replace('ё', "е").chars() {
        if ch.is_alphanumeric() {
            output.push(ch);
            last_space = false;
        } else if matches!(ch, '.' | '_' | '-' | '/') {
            output.push(' ');
            last_space = true;
        } else if !last_space {
            output.push(' ');
            last_space = true;
        }
    }
    output.trim().to_string()
}

fn first_line(value: &str) -> &str {
    value.trim().lines().next().unwrap_or("Empty")
}

fn db_path() -> PathBuf {
    if let Some(base) = dirs::data_dir() {
        let path = base.join(APP_NAME).join(DB_FILENAME);
        if !path.exists() {
            let legacy_path = base.join(LEGACY_APP_NAME).join(LEGACY_DB_FILENAME);
            if legacy_path.exists() {
                let _ = fs::create_dir_all(path.parent().unwrap_or_else(|| path.as_path()));
                let _ = fs::copy(&legacy_path, &path);
            }
        }
        return path;
    }
    PathBuf::from(DB_FILENAME)
}
