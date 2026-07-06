use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row, ToSql, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

const APP_NAME: &str = "treeAI";
const DEFAULT_ENDPOINT: &str = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL: &str = "gpt-4.1-mini";
const DEFAULT_THEME: &str = "Minimal Light";
const API_CONTEXT_RECENT_MESSAGE_LIMIT: usize = 16;
const API_CONTEXT_SUMMARY_CHAR_LIMIT: usize = 420;
const API_CONTEXT_MESSAGE_CHAR_LIMIT: usize = 12_000;

fn normalize_theme(theme: &str) -> &'static str {
    match theme.trim() {
        "Minimal Light" => "Minimal Light",
        "Obsidian Dark" => "Obsidian Dark",
        "Paper" => "Paper",
        _ => DEFAULT_THEME,
    }
}
const NODE_COLORS: [&str; 6] = ["slate", "sky", "mint", "amber", "rose", "violet"];

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsInput {
    pub endpoint: String,
    pub model: String,
    pub api_key: String,
    pub theme: String,
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
                ",
            )
            .map_err(|e| e.to_string())?;
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
        let mut messages = vec![ChatContextMessage {
            role: "system".to_string(),
            content: "You are a helpful assistant inside a polished local tree-based AI chat app. The user can write only in leaf branches; parent nodes are navigation/context only. Answer clearly and keep context from the selected tree path. If the current branch contains a message starting with \"Контекст ветки\", treat it as the branch contract and do not drift back to the parent topic unless the user explicitly asks to compare with it. When the user says \"распиши\", \"расшарь\", \"разверни\", \"подробнее\", \"раскрой\", \"объясни глубже\", or similar, produce a complete, branch-specific expansion with concrete structure, examples, caveats, and next steps. Use Markdown, and render formulas in LaTeX when math is useful. Prefer visual Mermaid diagrams when they make the answer clearer; avoid large ASCII diagrams unless the user explicitly asks for text-only output. Use fenced ```mermaid blocks for static diagrams and choose the diagram type by meaning: flowchart for processes/graphs/networks, sequenceDiagram for interactions/protocols, stateDiagram for automata/states, classDiagram or erDiagram for data models, gitGraph for branches/commits, pie for proportions/statistics, xychart for simple numeric trends, timeline for chronology, gantt for schedules/plans, mindmap for topic maps, journey for user flows, quadrantChart for prioritization, and sankey for flows/distribution. For step-by-step algorithms or evolving systems, use a fenced ```graphsteps block containing ONLY a JSON array of objects with fields step, description, and graph, where graph is Mermaid code. You may insert one interactive quiz when it helps learning: after a complex explanation, after code, after a graph/visualization, at the end of an answer, or when the user asks to be checked. If the user asks for a test, quiz, проверку, or \"проверь меня\", include the actual interactive quiz as fenced ```quiz, not plain JSON, not a ```json block, and not a bullet list of answers. Use a fenced ```quiz block containing ONLY JSON. Supported MVP types are single_choice, multiple_choice, and text. Shape: {\"id\":\"short-stable-id\",\"type\":\"single_choice|multiple_choice|text\",\"question\":\"...\",\"options\":[{\"id\":\"a\",\"text\":\"...\"}],\"answer\":\"a\"} for single choice, {\"answers\":[\"a\",\"c\"]} for multiple choice, or {\"accepted_answers\":[\"...\"]} for text. Always include \"explanation\" and optionally \"points\". Keep correct answers only inside the quiz JSON, not in the visible prose before the user answers. Do not use HTML or iframes.".to_string(),
        }, ChatContextMessage {
            role: "system".to_string(),
            content: local_context.clone(),
        }];

        for row in rows {
            if matches!(row.role.as_str(), "user" | "assistant" | "system") {
                if latest_user_id.as_deref() == Some(row.id.as_str()) {
                    messages.push(ChatContextMessage {
                        role: "system".to_string(),
                        content: format!(
                            "Immediate context for the next user request:\n{local_context}\nIf the request is short or deictic, answer about \"{current_title}\" specifically, not about the broad parent/root material."
                        ),
                    });
                    if wants_step_graph_response(&row.content, &current_title, &breadcrumb) {
                        messages.push(ChatContextMessage {
                            role: "system".to_string(),
                            content: step_graph_prompt(&current_title, &breadcrumb, &row.content),
                        });
                    }
                }
                let content = if latest_user_id.as_deref() == Some(row.id.as_str())
                    && is_deictic_topic_request(&row.content)
                {
                    format!(
                        "Current selected leaf/topic: {current_title}\nFull selected path: {breadcrumb}\nUser request about this current leaf/topic: {}",
                        row.content
                    )
                } else {
                    truncate_for_api_context(&row.content, API_CONTEXT_MESSAGE_CHAR_LIMIT)
                };
                messages.push(ChatContextMessage {
                    role: row.role,
                    content,
                });
            }
        }
        Ok(messages)
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
        Ok(ChatSettings {
            endpoint: self.get_setting("endpoint", DEFAULT_ENDPOINT)?,
            model: self.get_setting("model", DEFAULT_MODEL)?,
            api_key: self.get_setting("api_key", "")?,
            theme: normalize_theme(&theme).to_string(),
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
        self.set_setting("endpoint", endpoint)?;
        self.set_setting("model", model)?;
        self.set_setting("api_key", input.api_key.trim())?;
        self.set_setting("theme", theme)?;
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

fn is_deictic_topic_request(value: &str) -> bool {
    let text = value.trim().to_lowercase();
    let deictic = [
        "эту тему",
        "эта тема",
        "этой теме",
        "про эту тему",
        "данную тему",
        "эту ветку",
        "эта ветка",
        "здесь",
        "текущий лист",
        "текущую тему",
    ]
    .iter()
    .any(|needle| text.contains(needle));
    let action = [
        "опиши",
        "объясни",
        "распиши",
        "раскрой",
        "расскажи",
        "разверни",
        "подробнее",
        "что это",
    ]
    .iter()
    .any(|needle| text.contains(needle));
    deictic || (action && text.chars().count() <= 80)
}

fn wants_step_graph_response(user_request: &str, current_title: &str, breadcrumb: &str) -> bool {
    let text = format!("{user_request}\n{current_title}\n{breadcrumb}").to_lowercase();
    let asks_visual = [
        "граф",
        "визуал",
        "покажи",
        "пошаг",
        "по шаг",
        "итерац",
        "стрел",
        "сеть",
        "network",
    ]
    .iter()
    .any(|needle| text.contains(needle));
    let algorithm = [
        "диниц",
        "dinic",
        "максимальн",
        "max-flow",
        "max flow",
        "поток",
        "ford",
        "fulkerson",
        "edmonds",
        "karp",
        "bfs",
        "dfs",
        "dijkstra",
        "дейкстр",
    ]
    .iter()
    .any(|needle| text.contains(needle));
    asks_visual || algorithm
}

fn step_graph_prompt(current_title: &str, breadcrumb: &str, user_request: &str) -> String {
    format!(
        r#"The current request needs an interactive step-by-step Mermaid visualization, but it must stay on the exact selected topic.

SELECTED CONTEXT:
- Current leaf/topic: {current_title}
- Full selected path: {breadcrumb}
- Latest user request: {user_request}

TOPIC SELECTION RULES:
- Infer the exact algorithm/topic from the selected leaf, breadcrumb, latest user request, and recent dialogue.
- Visualize that exact algorithm/topic only.
- Do not import an algorithm, graph, labels, variables, or story from examples or from a neighboring branch.
- If the selected topic and latest request do not identify enough details for a meaningful example, ask a short clarifying question instead of drawing an unrelated algorithm.
- If the topic is a graph algorithm, choose a small example graph that demonstrates that algorithm's own mechanics.

MANDATORY OUTPUT RULES:
- Include exactly one fenced ```graphsteps block.
- The graphsteps block must contain ONLY a valid JSON array.
- The array must have at least 4 steps, and at least 5 steps for complex algorithms.
- Every item must have "step", "description", and "graph".
- Every "graph" must be valid Mermaid code. For graph/flow/network algorithms, use flowchart code with arrows like S --> A and labels like |0/10| or |10/10|. For other evolving explanations, choose the Mermaid type that fits: sequenceDiagram for interactions, stateDiagram for states, gitGraph for commit history, timeline for chronology, gantt for schedules, pie/xychart for changing statistics, or mindmap for staged topic expansion.
- Labelled flowchart arrows must be written exactly as A -->|10/10| B. Never write A --|10/10|> B.
- Mermaid flowcharts do not accept reverse arrows like A <-- B. To show a reversed edge, write B --> A instead.
- Do not answer with only the initial graph. Show the actual progression of the current algorithm/topic.
- Use Mermaid classDef/class or visibly changed labels to highlight what changed in each step.
- Do not use HTML, iframe, SVG code, or plain ASCII art.
"#
    )
}

fn first_line(value: &str) -> &str {
    value.trim().lines().next().unwrap_or("Empty")
}

fn db_path() -> PathBuf {
    if let Some(base) = dirs::data_dir() {
        return base.join(APP_NAME).join("treeai.sqlite3");
    }
    PathBuf::from("treeai.sqlite3")
}
