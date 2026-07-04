use rusqlite::{params, params_from_iter, Connection, OptionalExtension, ToSql};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

const APP_NAME: &str = "treeAI";
const DEFAULT_ENDPOINT: &str = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL: &str = "gpt-4.1-mini";

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
pub struct ChatSettings {
    pub endpoint: String,
    pub model: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsInput {
    pub endpoint: String,
    pub model: String,
    pub api_key: String,
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
                "SELECT id, tree_id, parent_id, title, summary, created_at, updated_at
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
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn get_node(&self, tree_id: &str, node_id: &str) -> Result<Node, String> {
        self.conn
            .query_row(
                "SELECT id, tree_id, parent_id, title, summary, created_at, updated_at
                 FROM nodes WHERE tree_id = ?1 AND id = ?2",
                params![tree_id, node_id],
                |row| {
                    Ok(Node {
                        id: row.get(0)?,
                        tree_id: row.get(1)?,
                        parent_id: row.get(2)?,
                        title: row.get(3)?,
                        summary: row.get(4)?,
                        created_at: row.get(5)?,
                        updated_at: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Node not found.".to_string())
    }

    pub fn is_leaf_node(&self, tree_id: &str, node_id: &str) -> Result<bool, String> {
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
        self.conn
            .execute(
                "UPDATE trees SET last_node_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![node_id, Self::now(), tree_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn create_child_node(
        &self,
        tree_id: &str,
        parent_id: &str,
        title: String,
    ) -> Result<String, String> {
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

    pub fn set_message_visualization(
        &self,
        tree_id: &str,
        node_id: &str,
        message_id: &str,
        visualization_html: &str,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE messages SET visualization_html = ?1
                 WHERE id = ?2 AND tree_id = ?3 AND node_id = ?4 AND role = 'assistant'",
                params![visualization_html, message_id, tree_id, node_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_messages_for_path(
        &self,
        tree_id: &str,
        node_id: &str,
    ) -> Result<Vec<Message>, String> {
        let path = self.get_path_node_ids(node_id)?;
        if path.is_empty() {
            return Ok(Vec::new());
        }

        let placeholders = path.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT id, tree_id, node_id, role, content, visualization_html, created_at
             FROM messages WHERE tree_id = ? AND node_id IN ({placeholders})
             ORDER BY created_at"
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

    pub fn build_api_messages_for_node(
        &self,
        tree_id: &str,
        node_id: &str,
    ) -> Result<Vec<ChatContextMessage>, String> {
        let mut messages = vec![ChatContextMessage {
            role: "system".to_string(),
            content: "You are a helpful assistant inside a polished local tree-based AI chat app. The user can write only in leaf branches; parent nodes are navigation/context only. Answer clearly and keep context from the selected tree path. If the current branch contains a message starting with \"Контекст ветки\", treat it as the branch contract and do not drift back to the parent topic unless the user explicitly asks to compare with it. When the user says \"распиши\", \"расшарь\", \"разверни\", \"подробнее\", \"раскрой\", \"объясни глубже\", or similar, produce a complete, branch-specific expansion with concrete structure, examples, caveats, and next steps. Use Markdown, and render formulas in LaTeX when math is useful.".to_string(),
        }];

        for row in self.get_messages_for_path(tree_id, node_id)? {
            if matches!(row.role.as_str(), "user" | "assistant" | "system") {
                messages.push(ChatContextMessage {
                    role: row.role,
                    content: row.content,
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
        Ok(ChatSettings {
            endpoint: self.get_setting("endpoint", DEFAULT_ENDPOINT)?,
            model: self.get_setting("model", DEFAULT_MODEL)?,
            api_key: self.get_setting("api_key", "")?,
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
        self.set_setting("endpoint", endpoint)?;
        self.set_setting("model", model)?;
        self.set_setting("api_key", input.api_key.trim())?;
        self.get_settings()
    }

    fn get_path_node_ids(&self, node_id: &str) -> Result<Vec<String>, String> {
        let mut result = Vec::new();
        let mut current = Some(node_id.to_string());
        while let Some(id) = current {
            let (parent_id, this_id) = self
                .conn
                .query_row(
                    "SELECT parent_id, id FROM nodes WHERE id = ?1",
                    params![id],
                    |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
                )
                .map_err(|e| e.to_string())?;
            result.push(this_id);
            current = parent_id;
        }
        result.reverse();
        Ok(result)
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

fn clean_title_or(value: String, fallback: &str) -> String {
    let title = value.trim().chars().take(96).collect::<String>();
    if title.is_empty() {
        fallback.to_string()
    } else {
        title
    }
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
