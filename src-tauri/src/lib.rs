mod agent_tools;
mod api;
mod code_runner;
mod connectors;
mod context_builder;
mod local_embedding;
mod project;
mod retrieval_context;
mod store;
mod terminal;

use encoding_rs::WINDOWS_1251;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{hash_map::DefaultHasher, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, Window,
};

#[derive(Clone)]
pub struct AppState {
    store: Arc<Mutex<store::Store>>,
}

#[derive(Clone, Serialize)]
struct StreamDelta {
    request_id: String,
    tree_id: String,
    node_id: String,
    delta: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentToolEvent {
    request_id: String,
    tree_id: String,
    node_id: String,
    permission_profile: String,
    tool: String,
    ok: bool,
    content: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeWatchEvent {
    ok: bool,
    content: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchPageResult {
    query: String,
    answer: String,
    memory_results: Vec<store::MemorySearchResult>,
    knowledge_results: Vec<store::KnowledgeSearchResult>,
    related_memory: Vec<store::RetrievalRelatedMemoryTrace>,
    source_count: usize,
    chunk_count: usize,
    used_model: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentTrace {
    permission_profile: Option<String>,
    tool_results: Vec<agent_tools::AgentToolResult>,
    verifier: Option<AgentVerifierTrace>,
    retrieval: Option<store::RetrievalTrace>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentVerifierTrace {
    revised: bool,
    issues: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct VerifiedAgentAnswer {
    answer: String,
    #[serde(default)]
    issues: Vec<String>,
}

const BRANCH_PLAN_ACTION_MARKER: &str = "<!-- treeai:branch-plan -->";
const BRANCH_PLAN_PAYLOAD_FENCE: &str = "ino-agent-branch-plan";

fn lock_store(store: &Arc<Mutex<store::Store>>) -> Result<MutexGuard<'_, store::Store>, String> {
    store.lock().map_err(|e| e.to_string())
}

#[tauri::command]
fn list_trees(state: State<AppState>) -> Result<Vec<store::TreeSummary>, String> {
    lock_store(&state.store)?.list_trees()
}

#[tauri::command]
fn create_tree(
    state: State<AppState>,
    title: Option<String>,
) -> Result<store::TreeCreated, String> {
    lock_store(&state.store)?.create_tree(title.unwrap_or_else(|| "Root".to_string()))
}

#[tauri::command]
fn delete_tree(state: State<AppState>, tree_id: String) -> Result<(), String> {
    lock_store(&state.store)?.delete_tree(&tree_id)
}

#[tauri::command]
fn set_current_node(
    state: State<AppState>,
    tree_id: String,
    node_id: String,
) -> Result<(), String> {
    lock_store(&state.store)?.set_last_node(&tree_id, &node_id)
}

#[tauri::command]
fn create_child_node(
    state: State<AppState>,
    tree_id: String,
    parent_id: String,
    title: Option<String>,
) -> Result<String, String> {
    lock_store(&state.store)?.create_child_node(
        &tree_id,
        &parent_id,
        title.unwrap_or_else(|| "New node".to_string()),
    )
}

#[tauri::command]
fn rename_node(
    state: State<AppState>,
    tree_id: String,
    node_id: String,
    title: String,
) -> Result<(), String> {
    lock_store(&state.store)?.rename_node(&tree_id, &node_id, &title)
}

#[tauri::command]
fn set_node_color(
    state: State<AppState>,
    tree_id: String,
    node_id: String,
    color: Option<String>,
    include_descendants: bool,
) -> Result<(), String> {
    lock_store(&state.store)?.set_node_color(&tree_id, &node_id, color, include_descendants)
}

#[tauri::command]
fn delete_node(
    state: State<AppState>,
    tree_id: String,
    node_id: String,
) -> Result<store::DeleteNodeResult, String> {
    let store = &mut *lock_store(&state.store)?;
    let result = store.delete_node(&tree_id, &node_id)?;
    if let Some(parent_id) = &result.parent_id {
        store.set_last_node(&tree_id, parent_id)?;
    }
    Ok(result)
}

#[tauri::command]
fn get_tree_layout(
    state: State<AppState>,
    tree_id: String,
) -> Result<Vec<store::LayoutNode>, String> {
    lock_store(&state.store)?.layout_tree(&tree_id)
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Result<store::ChatSettings, String> {
    lock_store(&state.store)?.get_settings()
}

#[tauri::command]
fn save_settings(
    state: State<AppState>,
    input: store::SettingsInput,
) -> Result<store::ChatSettings, String> {
    lock_store(&state.store)?.save_settings(input)
}

#[tauri::command]
fn extract_pdf_text(bytes: Vec<u8>) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("PDF file is empty.".to_string());
    }
    pdf_extract::extract_text_from_mem(&bytes)
        .map(|text| clean_extracted_text(&text))
        .map_err(|e| format!("Could not extract PDF text: {e}"))
}

#[tauri::command]
fn get_messages(
    state: State<AppState>,
    tree_id: String,
    node_id: String,
) -> Result<Vec<store::Message>, String> {
    lock_store(&state.store)?.get_messages_for_path(&tree_id, &node_id)
}

#[tauri::command]
fn get_quiz_attempts(
    state: State<AppState>,
    tree_id: String,
    node_id: String,
) -> Result<Vec<store::QuizAttempt>, String> {
    lock_store(&state.store)?.get_quiz_attempts_for_path(&tree_id, &node_id)
}

#[tauri::command]
fn save_quiz_attempt(
    state: State<AppState>,
    tree_id: String,
    node_id: String,
    message_id: String,
    quiz_id: String,
    quiz_type: String,
    answer_json: String,
    is_correct: bool,
    score: f64,
    max_score: f64,
    explanation: String,
) -> Result<store::QuizAttempt, String> {
    lock_store(&state.store)?.save_quiz_attempt(
        &tree_id,
        &node_id,
        &message_id,
        &quiz_id,
        &quiz_type,
        &answer_json,
        is_correct,
        score,
        max_score,
        &explanation,
    )
}

#[tauri::command]
fn add_user_message(
    state: State<AppState>,
    tree_id: String,
    node_id: String,
    content: String,
) -> Result<store::Message, String> {
    let store = &mut *lock_store(&state.store)?;
    if !store.is_leaf_node(&tree_id, &node_id)? {
        return Err("Parent branches are read-only. Select or create a leaf branch.".to_string());
    }
    store.add_message(&tree_id, &node_id, "user", &content)
}

#[tauri::command]
fn edit_user_message(
    state: State<AppState>,
    tree_id: String,
    message_id: String,
    content: String,
) -> Result<store::Message, String> {
    lock_store(&state.store)?.edit_user_message(&tree_id, &message_id, &content)
}

#[tauri::command]
async fn regenerate_assistant_reply(
    window: Window,
    state: State<'_, AppState>,
    tree_id: String,
    message_id: String,
    request_id: Option<String>,
) -> Result<store::AssistantReplyResult, String> {
    let store = state.store.clone();
    let request_id = request_id.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let node_id = {
            let store = &mut *lock_store(&store)?;
            store.truncate_from_assistant_message(&tree_id, &message_id)?
        };
        generate_assistant_reply_blocking(window, store, tree_id, node_id, request_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn generate_assistant_reply(
    window: Window,
    state: State<'_, AppState>,
    tree_id: String,
    node_id: String,
    request_id: Option<String>,
) -> Result<store::AssistantReplyResult, String> {
    let store = state.store.clone();
    let request_id = request_id.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        generate_assistant_reply_blocking(window, store, tree_id, node_id, request_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn confirm_pending_branches(
    state: State<AppState>,
    tree_id: String,
    node_id: String,
    titles: Option<Vec<String>>,
) -> Result<store::AssistantReplyResult, String> {
    let store = &mut *lock_store(&state.store)?;
    let plan = store
        .get_pending_branch_plan(&tree_id, &node_id)?
        .ok_or_else(|| "No branch plan is waiting for confirmation.".to_string())?;
    let parent = store.get_node(&tree_id, &node_id)?;
    let plan = match titles {
        Some(titles) => branch_plan_from_titles(&parent.title, &plan.question, titles)?,
        None => plan,
    };
    create_branches_from_plan(store, &tree_id, &node_id, &parent.title, &plan)
}

#[tauri::command]
async fn force_branch_split(
    state: State<'_, AppState>,
    tree_id: String,
    node_id: String,
) -> Result<store::AssistantReplyResult, String> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        force_branch_split_blocking(store, tree_id, node_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn run_code(
    request: code_runner::RunCodeRequest,
) -> Result<code_runner::RunCodeResponse, String> {
    tauri::async_runtime::spawn_blocking(move || code_runner::run_code(request))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn check_code(
    request: code_runner::CheckCodeRequest,
) -> Result<code_runner::CheckCodeResponse, String> {
    tauri::async_runtime::spawn_blocking(move || code_runner::check_code(request))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn list_connectors() -> Result<Vec<connectors::ConnectorSummary>, String> {
    connectors::list_connectors()
}

#[tauri::command]
async fn propose_connector(
    state: State<'_, AppState>,
    tree_id: String,
    node_id: String,
    request: String,
) -> Result<connectors::ConnectorSummary, String> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (settings, tree_title, node_title) = {
            let store = lock_store(&store)?;
            let node = store.get_node(&tree_id, &node_id)?;
            let tree_title = store
                .list_trees()?
                .into_iter()
                .find(|tree| tree.id == tree_id)
                .map(|tree| tree.title)
                .unwrap_or_else(|| node.title.clone());
            (store.get_settings()?, tree_title, node.title)
        };
        let messages = vec![
            store::ChatContextMessage {
                role: "system".to_string(),
                content: connectors::connector_prompt(&request, &tree_title, &node_title),
            },
            store::ChatContextMessage {
                role: "user".to_string(),
                content: request,
            },
        ];
        let answer = api::chat_completion(&settings, &messages)?;
        let draft = connectors::parse_model_draft(&answer)?;
        connectors::save_draft(draft)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn set_connector_enabled(
    id: String,
    enabled: bool,
) -> Result<connectors::ConnectorSummary, String> {
    connectors::set_enabled(&id, enabled)
}

#[tauri::command]
async fn revise_assistant_message(
    state: State<'_, AppState>,
    tree_id: String,
    message_id: String,
    instruction: String,
) -> Result<store::Message, String> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (settings, message) = {
            let store = lock_store(&store)?;
            let message = store.get_message(&tree_id, &message_id)?;
            if message.role != "assistant" {
                return Err("Only assistant messages can be revised in place.".to_string());
            }
            (store.get_settings()?, message)
        };
        let messages = vec![
            store::ChatContextMessage {
                role: "system".to_string(),
                content: "You revise one saved assistant message in a local chat database. Apply the user's instruction to the existing message. Preserve everything unrelated, especially Markdown structure, code fences, diagrams, and quiz blocks. If the user asks to modify code in the previous message, edit that code block in place instead of rewriting the whole answer from scratch. Return ONLY JSON: {\"content\":\"full updated message content\"}.".to_string(),
            },
            store::ChatContextMessage {
                role: "user".to_string(),
                content: format!(
                    "Instruction:\n{}\n\nExisting assistant message:\n{}",
                    instruction.trim(),
                    message.content
                ),
            },
        ];
        let answer = api::chat_completion(&settings, &messages)?;
        let content = parse_revised_content(&answer)?;
        let store = &mut *lock_store(&store)?;
        store.update_assistant_message(&tree_id, &message_id, &content)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn add_memory(
    state: State<AppState>,
    input: store::MemoryInput,
) -> Result<store::MemoryItem, String> {
    let store = &mut *lock_store(&state.store)?;
    store.add_memory(input)
}

#[tauri::command]
fn update_memory(
    state: State<AppState>,
    id: String,
    input: store::MemoryInput,
) -> Result<store::MemoryItem, String> {
    let store = &mut *lock_store(&state.store)?;
    store.update_memory(&id, input)
}

#[tauri::command]
fn merge_memory(
    state: State<AppState>,
    keep_id: String,
    remove_id: String,
) -> Result<store::MemoryItem, String> {
    let store = &mut *lock_store(&state.store)?;
    store.merge_memory(&keep_id, &remove_id)
}

#[tauri::command]
fn search_memory(
    state: State<AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<store::MemorySearchResult>, String> {
    lock_store(&state.store)?.search_memory(&query, limit.unwrap_or(12))
}

#[tauri::command]
fn search_knowledge(
    state: State<AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<store::KnowledgeSearchResult>, String> {
    lock_store(&state.store)?.search_knowledge(&query, limit.unwrap_or(12))
}

#[tauri::command]
async fn search_page(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<SearchPageResult, String> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let limit = limit.unwrap_or(10).clamp(1, 24);
        let query = query.trim().chars().take(500).collect::<String>();
        if query.is_empty() {
            return Err("Search query is empty.".to_string());
        }
        let (settings, memory_results, knowledge_results, related_memory) = {
            let store = lock_store(&store)?;
            let memory_results = store.search_memory(&query, limit)?;
            let knowledge_results = store.search_knowledge(&query, limit)?;
            let related_memory = store
                .retrieval_trace_for_query(&query, limit)?
                .related_memory;
            (
                store.get_settings()?,
                memory_results,
                knowledge_results,
                related_memory,
            )
        };
        let source_count = knowledge_results
            .iter()
            .map(|result| result.source.id.clone())
            .collect::<HashSet<_>>()
            .len()
            + memory_results.len();
        let chunk_count = knowledge_results.len();
        let fallback_answer = fallback_search_answer(&query, &memory_results, &knowledge_results);
        let answer = synthesize_search_answer(
            &settings,
            &query,
            &memory_results,
            &knowledge_results,
            &related_memory,
        )
        .unwrap_or_else(|_| fallback_answer.clone());
        let used_model = answer.trim() != fallback_answer.trim();
        Ok(SearchPageResult {
            query,
            answer,
            memory_results,
            knowledge_results,
            related_memory,
            source_count,
            chunk_count,
            used_model,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn list_memory_recent(
    state: State<AppState>,
    limit: Option<usize>,
) -> Result<Vec<store::MemoryItem>, String> {
    lock_store(&state.store)?.list_memory_recent(limit.unwrap_or(24))
}

#[tauri::command]
fn list_memory_decisions(
    state: State<AppState>,
    limit: Option<usize>,
) -> Result<Vec<store::MemoryDecision>, String> {
    lock_store(&state.store)?.list_memory_decisions(limit.unwrap_or(24))
}

#[tauri::command]
fn list_memory_review(
    state: State<AppState>,
    limit: Option<usize>,
) -> Result<Vec<store::MemoryReviewItem>, String> {
    lock_store(&state.store)?.memory_review_queue(limit.unwrap_or(24))
}

#[tauri::command]
fn export_memory(state: State<AppState>) -> Result<String, String> {
    lock_store(&state.store)?.export_memory_json()
}

#[tauri::command]
fn import_memory(
    state: State<AppState>,
    json: String,
) -> Result<store::MemoryImportResult, String> {
    let store = &mut *lock_store(&state.store)?;
    store.import_memory_json(&json)
}

#[tauri::command]
fn delete_memory(state: State<AppState>, id: String) -> Result<(), String> {
    let store = &mut *lock_store(&state.store)?;
    store.delete_memory(&id)
}

#[tauri::command]
fn record_feedback(state: State<AppState>, input: store::FeedbackInput) -> Result<(), String> {
    let store = &mut *lock_store(&state.store)?;
    store.record_feedback(input)
}

#[tauri::command]
fn list_feedback_summary(
    state: State<AppState>,
    limit: Option<usize>,
) -> Result<Vec<store::FeedbackSummary>, String> {
    lock_store(&state.store)?.feedback_summary(limit.unwrap_or(12))
}

#[tauri::command]
fn get_memory_graph(
    state: State<AppState>,
    limit: Option<usize>,
) -> Result<store::MemoryGraph, String> {
    lock_store(&state.store)?.memory_graph(limit.unwrap_or(36))
}

#[tauri::command]
fn list_watched_paths(state: State<AppState>) -> Result<Vec<store::WatchedPath>, String> {
    lock_store(&state.store)?.list_watched_paths()
}

#[tauri::command]
fn watch_path(state: State<AppState>, path: String) -> Result<Vec<store::WatchedPath>, String> {
    lock_store(&state.store)?.add_watched_path(&path)
}

#[tauri::command]
fn unwatch_path(state: State<AppState>, path: String) -> Result<Vec<store::WatchedPath>, String> {
    lock_store(&state.store)?.remove_watched_path(&path)
}

#[tauri::command]
fn poll_watched_paths(state: State<AppState>) -> Result<Value, String> {
    index_watched_paths(state.store.clone())
}

#[tauri::command]
fn resolve_target(target: String) -> Result<Value, String> {
    let workspace_root = agent_tools::workspace_root()?;
    agent_tools::resolve_target(&workspace_root, &target)
}

#[tauri::command]
fn list_project_stacks() -> Result<Vec<project::ProjectStackSummary>, String> {
    Ok(project::list_project_stacks())
}

#[tauri::command]
fn create_project(
    request: project::CreateProjectRequest,
) -> Result<project::CreatedProject, String> {
    let workspace_root = agent_tools::workspace_root()?;
    project::create_project(&workspace_root, request)
}

#[tauri::command]
async fn run_project_command(
    request: project::RunProjectCommandRequest,
) -> Result<project::ProjectCommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_root = agent_tools::workspace_root()?;
        project::run_project_command(&workspace_root, request)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn assess_terminal_command(
    request: terminal::TerminalCommandRequest,
) -> Result<terminal::TerminalCommandSafety, String> {
    let workspace_root = agent_tools::workspace_root()?;
    terminal::assess_command(&workspace_root, &request)
}

#[tauri::command]
async fn run_terminal_command(
    state: State<'_, AppState>,
    request: terminal::TerminalCommandRequest,
) -> Result<terminal::TerminalCommandResult, String> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_root = agent_tools::workspace_root()?;
        let result = terminal::run_command(&workspace_root, request)?;
        {
            let store = &mut *lock_store(&store)?;
            store.record_terminal_command(&result)?;
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn list_terminal_history(
    state: State<AppState>,
    limit: Option<usize>,
) -> Result<Vec<store::TerminalCommandHistoryItem>, String> {
    lock_store(&state.store)?.list_terminal_history(limit.unwrap_or(30))
}

#[tauri::command]
fn list_agent_runs(
    state: State<AppState>,
    limit: Option<usize>,
) -> Result<Vec<store::AgentRunDetail>, String> {
    lock_store(&state.store)?.list_agent_runs(limit.unwrap_or(12))
}

#[tauri::command]
async fn create_agent_run(
    state: State<'_, AppState>,
    input: store::AgentRunInput,
) -> Result<store::AgentRunDetail, String> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let settings = lock_store(&store)?.get_settings()?;
        let plan = create_agent_run_plan(&settings, &input)
            .unwrap_or_else(|_| fallback_agent_run_plan(&input.goal, input.title.as_deref()));
        let store = &mut *lock_store(&store)?;
        store.create_agent_run(input, plan)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn advance_agent_run(
    window: Window,
    state: State<'_, AppState>,
    run_id: String,
    request_id: Option<String>,
) -> Result<store::AgentRunDetail, String> {
    let store = state.store.clone();
    let request_id = request_id.unwrap_or_else(|| format!("agent-run:{run_id}"));
    tauri::async_runtime::spawn_blocking(move || {
        let task = {
            let store_guard = lock_store(&store)?;
            store_guard.start_next_agent_task(&run_id)?
        };
        let Some(task) = task else {
            return lock_store(&store)?.get_agent_run(&run_id);
        };

        let (settings, detail) = {
            let store_guard = lock_store(&store)?;
            (
                store_guard.get_settings()?,
                store_guard.get_agent_run(&run_id)?,
            )
        };
        let tree_id = detail
            .run
            .tree_id
            .clone()
            .unwrap_or_else(|| detail.run.id.clone());
        let node_id = detail
            .run
            .node_id
            .clone()
            .unwrap_or_else(|| task.id.clone());
        let messages = agent_run_execution_messages(&detail, &task);
        let latest_user = agent_run_task_request(&detail, &task);

        let output = run_agent_tool_turn(
            window,
            store.clone(),
            &settings,
            &messages,
            &latest_user,
            &tree_id,
            &node_id,
            &request_id,
        )
        .and_then(|output| {
            if let Some(output) = output {
                Ok(output)
            } else {
                let answer = api::chat_completion(&settings, &messages)?;
                Ok(AgentTurnOutput {
                    answer,
                    trace_json: String::new(),
                })
            }
        });

        match output {
            Ok(output) => {
                let trace_json = if output.trace_json.trim().is_empty() {
                    None
                } else {
                    Some(output.trace_json)
                };
                lock_store(&store)?.complete_agent_task(
                    &run_id,
                    &task.id,
                    &output.answer,
                    trace_json,
                )
            }
            Err(error) => lock_store(&store)?.fail_agent_task(&run_id, &task.id, &error),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn start_knowledge_watcher(app: AppHandle, store: Arc<Mutex<store::Store>>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(45));
        let event = match index_watched_paths(store.clone()) {
            Ok(content) => KnowledgeWatchEvent { ok: true, content },
            Err(error) => KnowledgeWatchEvent {
                ok: false,
                content: serde_json::json!({ "error": error }),
            },
        };
        let _ = app.emit("knowledge-watch-indexed", event);
    });
}

fn index_watched_paths(store: Arc<Mutex<store::Store>>) -> Result<Value, String> {
    let workspace_root = agent_tools::workspace_root()?;
    let watched = lock_store(&store)?.list_watched_paths()?;
    let mut indexed = Vec::new();
    let mut errors = Vec::new();
    for item in watched {
        let result = {
            let store = &mut *lock_store(&store)?;
            agent_tools::index_workspace_path(store, &workspace_root, &item.path, 80, 240)
        };
        match result {
            Ok(content) => indexed.push(content),
            Err(error) => errors.push(serde_json::json!({
                "path": item.path,
                "error": error,
            })),
        }
    }
    Ok(serde_json::json!({
        "indexed": indexed,
        "errors": errors,
    }))
}

fn force_branch_split_blocking(
    store: Arc<Mutex<store::Store>>,
    tree_id: String,
    node_id: String,
) -> Result<store::AssistantReplyResult, String> {
    let (parent_title, parent_summary, settings, messages, latest_user, latest_assistant) = {
        let store = lock_store(&store)?;
        if !store.is_leaf_node(&tree_id, &node_id)? {
            return Err(
                "Parent branches are read-only. Select or create a leaf branch.".to_string(),
            );
        }
        let parent = store.get_node(&tree_id, &node_id)?;
        let current_rows = store.get_messages_for_node(&tree_id, &node_id)?;
        let mut latest_user = String::new();
        let mut latest_assistant = String::new();
        for row in current_rows.iter().rev() {
            if latest_user.is_empty() && row.role == "user" {
                latest_user = row.content.clone();
            }
            if latest_assistant.is_empty() && row.role == "assistant" {
                latest_assistant = row.content.clone();
            }
            if !latest_user.is_empty() && !latest_assistant.is_empty() {
                break;
            }
        }
        let messages = current_rows
            .iter()
            .filter(|message| message.role != "system")
            .map(|message| store::ChatContextMessage {
                role: message.role.clone(),
                content: message.content.clone(),
            })
            .collect::<Vec<_>>();
        (
            parent.title,
            parent.summary,
            store.get_settings()?,
            messages,
            latest_user,
            latest_assistant,
        )
    };

    let branch_limit = 7;
    let mut planner_messages = vec![
        store::ChatContextMessage {
            role: "system".to_string(),
            content: force_branch_planner_prompt(branch_limit),
        },
        store::ChatContextMessage {
            role: "system".to_string(),
            content: force_branch_focus_prompt(&parent_title, parent_summary.as_deref()),
        },
    ];
    planner_messages.extend(messages);

    let mut plan = api::chat_completion(&settings, &planner_messages)
        .ok()
        .and_then(|answer| api::parse_branch_plan(&answer, branch_limit));
    if plan.is_none() {
        plan = fallback_branch_plan_from_text(&latest_user).or_else(|| {
            if looks_like_created_branch_list(&latest_assistant) {
                None
            } else {
                fallback_branch_plan_from_text(&latest_assistant)
            }
        });
    }
    let Some(plan) = plan else {
        return Err("Не смог выделить отдельные ветки из текущего контекста.".to_string());
    };

    let store = &mut *lock_store(&store)?;
    save_branch_plan_question(store, &tree_id, &node_id, &plan)
}

fn generate_assistant_reply_blocking(
    window: Window,
    store: Arc<Mutex<store::Store>>,
    tree_id: String,
    node_id: String,
    request_id: String,
) -> Result<store::AssistantReplyResult, String> {
    let snapshot = {
        let store = lock_store(&store)?;
        let rows = store.get_messages_for_node(&tree_id, &node_id)?;
        let mut latest_user = String::new();
        let mut latest_user_id = String::new();
        for row in rows.iter().rev() {
            if latest_user.is_empty() && row.role == "user" {
                latest_user = row.content.clone();
                latest_user_id = row.id.clone();
            }
            if !latest_user.is_empty() {
                break;
            }
        }
        let settings = store.get_settings()?;
        let messages = store.build_api_messages_for_node(&tree_id, &node_id)?;
        (latest_user, latest_user_id, settings, messages)
    };

    let (latest_user_raw, latest_user_id, settings, messages) = snapshot;
    let latest_user = strip_agent_mode_marker(&latest_user_raw);

    if let Some(memory_input) =
        remember_request_to_memory_input(&latest_user, &tree_id, &node_id, &latest_user_id)
    {
        let memory = {
            let store = &mut *lock_store(&store)?;
            store.add_memory(memory_input)?
        };
        let message = {
            let store = &mut *lock_store(&store)?;
            store.add_message(
                &tree_id,
                &node_id,
                "assistant",
                &format!(
                    "Запомнил: **{}**\n\nИсточник: `{}`",
                    memory.title, memory.target
                ),
            )?
        };
        return Ok(store::AssistantReplyResult {
            message,
            selected_node_id: node_id,
            created_branches: Vec::new(),
        });
    }

    if wants_agent_tools(&latest_user_raw) {
        if let Some(output) = run_agent_tool_turn(
            window.clone(),
            store.clone(),
            &settings,
            &messages,
            &latest_user_raw,
            &tree_id,
            &node_id,
            &request_id,
        )? {
            let message = {
                let store = &mut *lock_store(&store)?;
                store.add_message_with_visualization(
                    &tree_id,
                    &node_id,
                    "assistant",
                    &output.answer,
                    Some(output.trace_json),
                )?
            };
            let _ = maybe_auto_capture_memory(
                store.clone(),
                &settings,
                &tree_id,
                &node_id,
                &latest_user_id,
                &latest_user,
                &output.answer,
            );
            return Ok(store::AssistantReplyResult {
                message,
                selected_node_id: node_id,
                created_branches: Vec::new(),
            });
        }
    }

    let answer = api::chat_completion_stream(&settings, &messages, |delta| {
        let _ = window.emit(
            "assistant-delta",
            StreamDelta {
                request_id: request_id.clone(),
                tree_id: tree_id.clone(),
                node_id: node_id.clone(),
                delta,
            },
        );
    })?;
    let message = {
        let store = &mut *lock_store(&store)?;
        let trace_json = assistant_trace_json(
            None,
            Vec::new(),
            None,
            store.retrieval_trace_for_query(&latest_user, 6).ok(),
        )?;
        store.add_message_with_visualization(
            &tree_id,
            &node_id,
            "assistant",
            &answer,
            trace_json,
        )?
    };
    let _ = maybe_auto_capture_memory(
        store.clone(),
        &settings,
        &tree_id,
        &node_id,
        &latest_user_id,
        &latest_user,
        &answer,
    );
    Ok(store::AssistantReplyResult {
        message,
        selected_node_id: node_id,
        created_branches: Vec::new(),
    })
}

fn save_branch_plan_question(
    store: &mut store::Store,
    tree_id: &str,
    node_id: &str,
    plan: &store::BranchPlan,
) -> Result<store::AssistantReplyResult, String> {
    store.save_pending_branch_plan(tree_id, node_id, plan)?;
    let branches = plan
        .branches
        .iter()
        .map(|branch| serde_json::json!({ "title": branch.title }))
        .collect::<Vec<_>>();
    let payload = serde_json::to_string_pretty(&serde_json::json!({ "branches": branches }))
        .map_err(|e| e.to_string())?;
    let content = format!(
        "{}\n\n```{}\n{}\n```\n\n{}",
        plan.question, BRANCH_PLAN_PAYLOAD_FENCE, payload, BRANCH_PLAN_ACTION_MARKER
    );
    let message = store.add_message(tree_id, node_id, "assistant", &content)?;
    Ok(store::AssistantReplyResult {
        message,
        selected_node_id: node_id.to_string(),
        created_branches: Vec::new(),
    })
}

fn create_branches_from_plan(
    store: &mut store::Store,
    tree_id: &str,
    node_id: &str,
    parent_title: &str,
    plan: &store::BranchPlan,
) -> Result<store::AssistantReplyResult, String> {
    store.create_branches_from_plan(tree_id, node_id, parent_title, plan)
}

fn branch_plan_from_titles(
    parent_title: &str,
    question: &str,
    titles: Vec<String>,
) -> Result<store::BranchPlan, String> {
    let mut seen = HashSet::new();
    let branches = titles
        .into_iter()
        .filter_map(|title| {
            let title = clean_branch_topic_title(&title);
            if title.is_empty() {
                return None;
            }
            let key = title.to_lowercase();
            if !seen.insert(key) {
                return None;
            }
            let context = generated_branch_context(parent_title, &title);
            Some(store::BranchPlanItem { title, context })
        })
        .collect::<Vec<_>>();

    if branches.is_empty() {
        return Err("Add at least one branch topic before creating branches.".to_string());
    }

    Ok(store::BranchPlan {
        question: question.to_string(),
        branches,
    })
}

fn clean_branch_topic_title(title: &str) -> String {
    title
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .trim_start_matches(|ch: char| {
            ch.is_ascii_digit()
                || ch == '-'
                || ch == '*'
                || ch == '.'
                || ch == ')'
                || ch.is_whitespace()
        })
        .trim()
        .chars()
        .take(80)
        .collect::<String>()
}

fn generated_branch_context(parent_title: &str, title: &str) -> String {
    format!(
        "Автоматически созданное направление для темы \"{}\" внутри родительской ветки \"{}\". В этой ветке нужно отдельно разобрать именно эту тему, использовать общий контекст родительского диалога и не смешивать ее с соседними направлениями.",
        title, parent_title
    )
}

#[derive(Debug, Deserialize)]
struct AgentDecision {
    #[serde(default)]
    final_answer: Option<String>,
    #[serde(default)]
    tool_calls: Vec<agent_tools::AgentToolCall>,
    #[serde(default)]
    tool_call: Option<agent_tools::AgentToolCall>,
}

struct AgentTurnOutput {
    answer: String,
    trace_json: String,
}

const AGENT_MAX_TOOL_ROUNDS: usize = 2;
const AGENT_MAX_TOOL_CALLS_PER_ROUND: usize = 4;
const AGENT_MAX_TOTAL_TOOL_CALLS: usize = 6;

#[derive(Debug, Deserialize)]
struct AutoMemoryPlan {
    #[serde(default)]
    items: Vec<AutoMemoryItem>,
}

#[derive(Debug, Deserialize)]
struct AutoMemoryItem {
    #[serde(default)]
    title: Option<String>,
    description: String,
    #[serde(default)]
    target: Option<String>,
    #[serde(default)]
    source_type: Option<String>,
    #[serde(default)]
    tags: Option<Vec<String>>,
    #[serde(default)]
    importance: Option<f64>,
    #[serde(default)]
    memory_kind: Option<String>,
    #[serde(default)]
    confidence: Option<f64>,
    #[serde(default)]
    stability: Option<String>,
}

fn create_agent_run_plan(
    settings: &store::ChatSettings,
    input: &store::AgentRunInput,
) -> Result<store::AgentRunPlan, String> {
    let messages = vec![
        store::ChatContextMessage {
            role: "system".to_string(),
            content: agent_run_planner_prompt(),
        },
        store::ChatContextMessage {
            role: "user".to_string(),
            content: format!(
                "Title hint: {}\n\nGoal:\n{}",
                input.title.as_deref().unwrap_or(""),
                input.goal.trim()
            ),
        },
    ];
    let raw = api::chat_completion(settings, &messages)?;
    parse_agent_run_plan(&raw).ok_or_else(|| "Could not parse agent run plan.".to_string())
}

fn fallback_agent_run_plan(goal: &str, title: Option<&str>) -> store::AgentRunPlan {
    let clean_goal = goal.trim();
    let fallback_title = clean_goal
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Agent run")
        .chars()
        .take(72)
        .collect::<String>();
    store::AgentRunPlan {
        title: title
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&fallback_title)
            .to_string(),
        prd: format!(
            "Goal\n\n{}\n\nSuccess criteria\n\n- The work is split into small, restartable tasks.\n- Each task has a concrete result or a clear blocker.\n- Progress is persisted after every step.",
            clean_goal
        ),
        specs: vec![
            "Keep each step atomic and verifiable.".to_string(),
            "Prefer read/build/test checks before broad changes.".to_string(),
            "Stop and mark a task failed when external input or approval is required.".to_string(),
        ],
        tasks: vec![
            store::AgentTaskDraft {
                title: "Understand current state".to_string(),
                description: "Inspect the relevant project context and summarize what already exists for the goal.".to_string(),
            },
            store::AgentTaskDraft {
                title: "Plan first implementation step".to_string(),
                description: "Identify the smallest next implementation step, expected files, and verification command.".to_string(),
            },
            store::AgentTaskDraft {
                title: "Verify progress".to_string(),
                description: "Run or describe the most relevant check and update the remaining work.".to_string(),
            },
        ],
    }
}

fn parse_agent_run_plan(raw: &str) -> Option<store::AgentRunPlan> {
    serde_json::from_str::<store::AgentRunPlan>(raw.trim())
        .ok()
        .or_else(|| {
            let text = raw.trim();
            if text.starts_with("```") {
                let inner = text
                    .lines()
                    .skip(1)
                    .take_while(|line| !line.trim_start().starts_with("```"))
                    .collect::<Vec<_>>()
                    .join("\n");
                serde_json::from_str::<store::AgentRunPlan>(inner.trim()).ok()
            } else {
                None
            }
        })
        .or_else(|| {
            let start = raw.find('{')?;
            let end = raw.rfind('}')?;
            if end <= start {
                return None;
            }
            serde_json::from_str::<store::AgentRunPlan>(&raw[start..=end]).ok()
        })
}

fn synthesize_search_answer(
    settings: &store::ChatSettings,
    query: &str,
    memory_results: &[store::MemorySearchResult],
    knowledge_results: &[store::KnowledgeSearchResult],
    related_memory: &[store::RetrievalRelatedMemoryTrace],
) -> Result<String, String> {
    if settings.api_key.trim().is_empty()
        || (memory_results.is_empty() && knowledge_results.is_empty())
    {
        return Err("No model or sources available.".to_string());
    }
    let messages = vec![
        store::ChatContextMessage {
            role: "system".to_string(),
            content: search_answer_prompt(),
        },
        store::ChatContextMessage {
            role: "user".to_string(),
            content: format!(
                "Query:\n{}\n\nMemory results:\n{}\n\nKnowledge chunks:\n{}\n\nRelated memory:\n{}",
                query,
                format_search_memory(memory_results),
                format_search_knowledge(knowledge_results),
                format_related_memory(related_memory)
            ),
        },
    ];
    let answer = api::chat_completion(settings, &messages)?;
    let answer = answer.trim();
    if answer.is_empty() {
        return Err("Model returned an empty search answer.".to_string());
    }
    Ok(answer.chars().take(6000).collect())
}

fn fallback_search_answer(
    query: &str,
    memory_results: &[store::MemorySearchResult],
    knowledge_results: &[store::KnowledgeSearchResult],
) -> String {
    if memory_results.is_empty() && knowledge_results.is_empty() {
        return format!("No indexed memory or knowledge chunks matched `{query}`.");
    }
    let mut lines = vec![format!("Found local context for `{query}`.")];
    if let Some(top) = knowledge_results.first() {
        lines.push(format!(
            "Top source: {} at {} (score {}%).",
            top.source.title,
            top.chunk.target,
            (top.score * 100.0).round() as i64
        ));
        lines.push(format!(
            "Snippet: {}",
            clip_search_text(&top.chunk.text, 420)
        ));
    }
    if let Some(top) = memory_results.first() {
        lines.push(format!(
            "Top memory: {} at {} (score {}%).",
            top.item.title,
            top.item.target,
            (top.score * 100.0).round() as i64
        ));
    }
    lines.push("Open the listed sources/chunks below for the exact context.".to_string());
    lines.join("\n\n")
}

fn search_answer_prompt() -> String {
    r#"You answer a local Search page query using only retrieved local memory and knowledge chunks.

Rules:
- Use only the provided sources. Do not invent facts.
- If sources are weak or partial, say what is known and what is missing.
- Be concise and practical.
- Cite source targets inline when useful, e.g. `(docs/file.md#chunk=2)`.
- Mention related memory only when it clearly helps.
- Preserve the user's language.
"#
    .to_string()
}

fn format_search_memory(results: &[store::MemorySearchResult]) -> String {
    if results.is_empty() {
        return "[]".to_string();
    }
    results
        .iter()
        .take(8)
        .map(|result| {
            format!(
                "- title: {}\n  target: {}\n  source_type: {}\n  score: {:.2}\n  description: {}",
                result.item.title,
                result.item.target,
                result.item.source_type,
                result.score,
                clip_search_text(&result.item.description, 700)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_search_knowledge(results: &[store::KnowledgeSearchResult]) -> String {
    if results.is_empty() {
        return "[]".to_string();
    }
    results
        .iter()
        .take(10)
        .map(|result| {
            format!(
                "- title: {}\n  target: {}\n  source_type: {}\n  offsets: {}-{}\n  score: {:.2}\n  text: {}",
                result.source.title,
                result.chunk.target,
                result.source.source_type,
                result.chunk.start_offset,
                result.chunk.end_offset,
                result.score,
                clip_search_text(&result.chunk.text, 900)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_related_memory(results: &[store::RetrievalRelatedMemoryTrace]) -> String {
    if results.is_empty() {
        return "[]".to_string();
    }
    results
        .iter()
        .take(8)
        .map(|result| {
            format!(
                "- title: {}\n  target: {}\n  relation: {}\n  weight: {:.2}",
                result.title, result.target, result.label, result.weight
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn clip_search_text(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.trim().to_string();
    }
    let mut clipped = value.chars().take(max_chars).collect::<String>();
    clipped.push_str("...");
    clipped
}

fn agent_run_execution_messages(
    detail: &store::AgentRunDetail,
    task: &store::AgentTask,
) -> Vec<store::ChatContextMessage> {
    let completed = detail
        .tasks
        .iter()
        .filter(|item| item.status == "done")
        .map(|item| {
            format!(
                "- {}. {}: {}",
                item.position,
                item.title,
                item.result
                    .as_deref()
                    .map(|value| clip_agent_progress(value, 700))
                    .unwrap_or_else(|| "done".to_string())
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    vec![
        store::ChatContextMessage {
            role: "system".to_string(),
            content: context_builder::base_assistant_prompt(),
        },
        store::ChatContextMessage {
            role: "system".to_string(),
            content: agent_run_executor_prompt(),
        },
        store::ChatContextMessage {
            role: "user".to_string(),
            content: format!(
                "Agent run: {}\nStatus: {}\n\nGoal:\n{}\n\nPRD:\n{}\n\nSpecs:\n{}\n\nCompleted progress:\n{}\n\nCurrent atomic task #{}:\n{}\n\n{}",
                detail.run.title,
                detail.run.status,
                detail.run.goal,
                detail.run.prd,
                detail
                    .run
                    .specs
                    .iter()
                    .map(|spec| format!("- {spec}"))
                    .collect::<Vec<_>>()
                    .join("\n"),
                if completed.trim().is_empty() {
                    "No completed tasks yet.".to_string()
                } else {
                    completed
                },
                task.position,
                task.title,
                task.description
            ),
        },
    ]
}

fn agent_run_task_request(detail: &store::AgentRunDetail, task: &store::AgentTask) -> String {
    format!(
        "<!-- ino-agent:mode=workspace -->\nAgent loop step. Execute exactly one atomic task and persist progress.\n\nRun: {}\nGoal: {}\nCurrent task: {}\nTask description: {}\n\nUse local tools only when needed. Prefer inspection and verification. Do not perform destructive actions. Return a concise progress result with: Done, Evidence, Next.",
        detail.run.title, detail.run.goal, task.title, task.description
    )
}

fn clip_agent_progress(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.trim().to_string();
    }
    let mut clipped = value.chars().take(max_chars).collect::<String>();
    clipped.push_str("...");
    clipped
}

fn run_agent_tool_turn(
    window: Window,
    store: Arc<Mutex<store::Store>>,
    settings: &store::ChatSettings,
    messages: &[store::ChatContextMessage],
    latest_user: &str,
    tree_id: &str,
    node_id: &str,
    request_id: &str,
) -> Result<Option<AgentTurnOutput>, String> {
    let workspace_root = agent_tools::workspace_root()?;
    let permission_profile = agent_tools::permission_profile_for_request(latest_user);
    let user_request = strip_agent_mode_marker(latest_user);
    let mut planner_messages = vec![store::ChatContextMessage {
        role: "system".to_string(),
        content: agent_tool_planner_prompt(
            tree_id,
            node_id,
            &workspace_root.display().to_string(),
            permission_profile,
        ),
    }];
    planner_messages.extend(messages.iter().cloned());

    let decision_text = api::chat_completion(settings, &planner_messages)?;
    let Some(mut decision) = parse_agent_decision(&decision_text) else {
        return Ok(None);
    };
    if let Some(call) = decision.tool_call.take() {
        decision.tool_calls.push(call);
    }
    if decision.tool_calls.is_empty() {
        return Ok(decision
            .final_answer
            .map(|answer| answer.trim().to_string())
            .filter(|answer| !answer.is_empty())
            .map(|answer| AgentTurnOutput {
                answer,
                trace_json: empty_agent_trace_json(permission_profile),
            }));
    }

    let mut tool_results = execute_agent_tool_calls(
        &window,
        store.clone(),
        &workspace_root,
        decision.tool_calls,
        request_id,
        tree_id,
        node_id,
        permission_profile,
        AGENT_MAX_TOOL_CALLS_PER_ROUND.min(AGENT_MAX_TOTAL_TOOL_CALLS),
    )?;
    for _round in 1..AGENT_MAX_TOOL_ROUNDS {
        if tool_results.len() >= AGENT_MAX_TOTAL_TOOL_CALLS {
            break;
        }
        let observed_results_json =
            serde_json::to_string_pretty(&tool_results).map_err(|e| e.to_string())?;
        let mut observer_messages = messages.to_vec();
        observer_messages.push(store::ChatContextMessage {
            role: "system".to_string(),
            content: agent_tool_observer_prompt(
                &user_request,
                &observed_results_json,
                AGENT_MAX_TOTAL_TOOL_CALLS - tool_results.len(),
            ),
        });
        let observer_text = api::chat_completion(settings, &observer_messages)?;
        let Some(mut followup) = parse_agent_decision(&observer_text) else {
            break;
        };
        if let Some(call) = followup.tool_call.take() {
            followup.tool_calls.push(call);
        }
        if followup.tool_calls.is_empty() {
            break;
        }
        let remaining = AGENT_MAX_TOTAL_TOOL_CALLS - tool_results.len();
        let mut next_results = execute_agent_tool_calls(
            &window,
            store.clone(),
            &workspace_root,
            followup.tool_calls,
            request_id,
            tree_id,
            node_id,
            permission_profile,
            remaining.min(AGENT_MAX_TOOL_CALLS_PER_ROUND),
        )?;
        tool_results.append(&mut next_results);
    }
    let tool_results_json =
        serde_json::to_string_pretty(&tool_results).map_err(|e| e.to_string())?;
    let mut final_messages = messages.to_vec();
    final_messages.push(store::ChatContextMessage {
        role: "system".to_string(),
        content: format!(
            "Agent tool results for the latest user request:\n```json\n{tool_results_json}\n```\nUse these results to answer the user directly. Do not invent tool output. If a tool failed, explain the failure plainly. If a memory or file target is relevant, mention it."
        ),
    });
    final_messages.push(store::ChatContextMessage {
        role: "system".to_string(),
        content: format!(
            "Latest user request was:\n{user_request}\n\nNow produce the final assistant answer. Do not return JSON and do not request another tool call."
        ),
    });
    let answer = api::chat_completion_stream(settings, &final_messages, |delta| {
        let _ = window.emit(
            "assistant-delta",
            StreamDelta {
                request_id: request_id.to_string(),
                tree_id: tree_id.to_string(),
                node_id: node_id.to_string(),
                delta,
            },
        );
    })?
    .trim()
    .to_string();
    if answer.is_empty() {
        return Ok(None);
    }
    let verification = verify_agent_answer(
        settings,
        messages,
        &user_request,
        &tool_results_json,
        &answer,
    )
    .unwrap_or_else(|_| VerifiedAgentAnswer {
        answer: answer.clone(),
        issues: Vec::new(),
    });
    let verified_answer = verification.answer.trim();
    let final_answer = if verified_answer.is_empty() {
        answer.clone()
    } else {
        verified_answer.to_string()
    };
    let revised = final_answer.trim() != answer.trim();
    let retrieval = lock_store(&store)
        .ok()
        .and_then(|store| store.retrieval_trace_for_query(&user_request, 6).ok());
    let trace_json = assistant_trace_json(
        Some(permission_profile.name().to_string()),
        tool_results.clone(),
        Some(AgentVerifierTrace {
            revised,
            issues: verification.issues,
        }),
        retrieval,
    )?
    .unwrap_or_else(|| empty_agent_trace_json(permission_profile));
    Ok(Some(AgentTurnOutput {
        answer: final_answer,
        trace_json,
    }))
}

fn execute_agent_tool_calls(
    window: &Window,
    store: Arc<Mutex<store::Store>>,
    workspace_root: &std::path::Path,
    calls: Vec<agent_tools::AgentToolCall>,
    request_id: &str,
    tree_id: &str,
    node_id: &str,
    permission_profile: agent_tools::AgentToolPermissionProfile,
    limit: usize,
) -> Result<Vec<agent_tools::AgentToolResult>, String> {
    calls
        .into_iter()
        .take(limit)
        .map(|call| {
            if agent_tools::tool_needs_store(&call.tool) {
                let store = &mut *lock_store(&store)?;
                let result = agent_tools::execute_tool(
                    Some(store),
                    workspace_root,
                    permission_profile,
                    call,
                );
                emit_agent_tool_event(
                    window,
                    request_id,
                    tree_id,
                    node_id,
                    permission_profile,
                    &result,
                );
                Ok(result)
            } else {
                let result =
                    agent_tools::execute_tool(None, workspace_root, permission_profile, call);
                emit_agent_tool_event(
                    window,
                    request_id,
                    tree_id,
                    node_id,
                    permission_profile,
                    &result,
                );
                Ok(result)
            }
        })
        .collect::<Result<Vec<_>, String>>()
}

fn emit_agent_tool_event(
    window: &Window,
    request_id: &str,
    tree_id: &str,
    node_id: &str,
    permission_profile: agent_tools::AgentToolPermissionProfile,
    result: &agent_tools::AgentToolResult,
) {
    let _ = window.emit(
        "agent-tool-result",
        AgentToolEvent {
            request_id: request_id.to_string(),
            tree_id: tree_id.to_string(),
            node_id: node_id.to_string(),
            permission_profile: permission_profile.name().to_string(),
            tool: result.tool.clone(),
            ok: result.ok,
            content: result.content.clone(),
        },
    );
}

fn empty_agent_trace_json(permission_profile: agent_tools::AgentToolPermissionProfile) -> String {
    serde_json::to_string(&AgentTrace {
        permission_profile: Some(permission_profile.name().to_string()),
        tool_results: Vec::new(),
        verifier: None,
        retrieval: None,
    })
    .unwrap_or_else(|_| {
        format!(
            "{{\"permissionProfile\":\"{}\",\"toolResults\":[],\"verifier\":null,\"retrieval\":null}}",
            permission_profile.name()
        )
    })
}

fn assistant_trace_json(
    permission_profile: Option<String>,
    tool_results: Vec<agent_tools::AgentToolResult>,
    verifier: Option<AgentVerifierTrace>,
    retrieval: Option<store::RetrievalTrace>,
) -> Result<Option<String>, String> {
    let has_trace = permission_profile.is_some()
        || !tool_results.is_empty()
        || verifier.is_some()
        || retrieval.as_ref().is_some_and(|trace| {
            !trace.memory_results.is_empty()
                || !trace.related_memory.is_empty()
                || !trace.knowledge_results.is_empty()
        });
    if !has_trace {
        return Ok(None);
    }
    serde_json::to_string(&AgentTrace {
        permission_profile,
        tool_results,
        verifier,
        retrieval,
    })
    .map(Some)
    .map_err(|e| e.to_string())
}

fn verify_agent_answer(
    settings: &store::ChatSettings,
    messages: &[store::ChatContextMessage],
    latest_user: &str,
    tool_results_json: &str,
    draft_answer: &str,
) -> Result<VerifiedAgentAnswer, String> {
    let mut verifier_messages = messages.to_vec();
    verifier_messages.push(store::ChatContextMessage {
        role: "system".to_string(),
        content: agent_answer_verifier_prompt(latest_user, tool_results_json, draft_answer),
    });
    let raw = api::chat_completion(settings, &verifier_messages)?;
    parse_verified_agent_answer(&raw).ok_or_else(|| "Could not parse verifier answer.".to_string())
}

fn parse_verified_agent_answer(raw: &str) -> Option<VerifiedAgentAnswer> {
    serde_json::from_str::<VerifiedAgentAnswer>(raw.trim())
        .ok()
        .or_else(|| {
            let text = raw.trim();
            if text.starts_with("```") {
                let inner = text
                    .lines()
                    .skip(1)
                    .take_while(|line| !line.trim_start().starts_with("```"))
                    .collect::<Vec<_>>()
                    .join("\n");
                serde_json::from_str::<VerifiedAgentAnswer>(inner.trim()).ok()
            } else {
                None
            }
        })
        .or_else(|| {
            let start = raw.find('{')?;
            let end = raw.rfind('}')?;
            if end <= start {
                return None;
            }
            serde_json::from_str::<VerifiedAgentAnswer>(&raw[start..=end]).ok()
        })
}

fn parse_agent_decision(raw: &str) -> Option<AgentDecision> {
    serde_json::from_str::<AgentDecision>(raw.trim())
        .ok()
        .or_else(|| {
            let text = raw.trim();
            if text.starts_with("```") {
                let inner = text
                    .lines()
                    .skip(1)
                    .take_while(|line| !line.trim_start().starts_with("```"))
                    .collect::<Vec<_>>()
                    .join("\n");
                serde_json::from_str::<AgentDecision>(inner.trim()).ok()
            } else {
                None
            }
        })
        .or_else(|| {
            let start = raw.find('{')?;
            let end = raw.rfind('}')?;
            if end <= start {
                return None;
            }
            serde_json::from_str::<AgentDecision>(&raw[start..=end]).ok()
        })
}

fn maybe_auto_capture_memory(
    store: Arc<Mutex<store::Store>>,
    settings: &store::ChatSettings,
    tree_id: &str,
    node_id: &str,
    latest_user_id: &str,
    latest_user: &str,
    assistant_answer: &str,
) -> Result<usize, String> {
    let current_target = chat_target(tree_id, node_id, latest_user_id);
    let fingerprint = auto_memory_fingerprint(&current_target, latest_user, assistant_answer);
    if lock_store(&store)?.has_memory_ingest_run(&fingerprint)? {
        record_auto_memory_decision(
            &store,
            &fingerprint,
            &current_target,
            "skipped",
            "already_processed",
            None,
            Some(latest_user),
            None,
        )?;
        return Ok(0);
    }
    if !looks_auto_memory_worthy(latest_user, assistant_answer) {
        let store = &mut *lock_store(&store)?;
        store.record_memory_decision(
            &fingerprint,
            &current_target,
            "skipped",
            "low_signal_turn",
            None,
            Some(latest_user),
            None,
        )?;
        store.mark_memory_ingest_run(&fingerprint, "chat-turn", &current_target)?;
        return Ok(0);
    }

    let extractor_messages = vec![
        store::ChatContextMessage {
            role: "system".to_string(),
            content: auto_memory_extractor_prompt(),
        },
        store::ChatContextMessage {
            role: "user".to_string(),
            content: format!(
                "Current chat target: {current_target}\n\nLatest user message:\n{}\n\nAssistant answer:\n{}",
                clip_for_memory_extractor(latest_user, 8_000),
                clip_for_memory_extractor(assistant_answer, 8_000)
            ),
        },
    ];
    let raw_plan = api::chat_completion(settings, &extractor_messages)?;
    let Some(plan) = parse_auto_memory_plan(&raw_plan) else {
        let store = &mut *lock_store(&store)?;
        store.record_memory_decision(
            &fingerprint,
            &current_target,
            "skipped",
            "extractor_parse_failed",
            None,
            Some(&raw_plan),
            None,
        )?;
        store.mark_memory_ingest_run(&fingerprint, "chat-turn", &current_target)?;
        return Ok(0);
    };

    let mut saved = 0usize;
    for item in plan.items.into_iter().take(3) {
        let description = item.description.trim();
        if description.chars().count() < 16 {
            record_auto_memory_decision(
                &store,
                &fingerprint,
                &current_target,
                "skipped",
                "description_too_short",
                item.title.as_deref(),
                Some(description),
                item.importance,
            )?;
            continue;
        }
        let importance = item.importance.unwrap_or(6.0).clamp(0.0, 10.0);
        if importance < 6.0 {
            record_auto_memory_decision(
                &store,
                &fingerprint,
                &current_target,
                "skipped",
                "importance_below_threshold",
                item.title.as_deref(),
                Some(description),
                Some(importance),
            )?;
            continue;
        }
        let is_duplicate = {
            let store = lock_store(&store)?;
            store
                .search_memory_readonly(description, 1)?
                .first()
                .is_some_and(|result| result.score >= 0.92)
        };
        if is_duplicate {
            record_auto_memory_decision(
                &store,
                &fingerprint,
                &current_target,
                "skipped",
                "duplicate_memory",
                item.title.as_deref(),
                Some(description),
                Some(importance),
            )?;
            continue;
        }

        let mut tags = item.tags.unwrap_or_default();
        tags.push("auto".to_string());
        tags.push("chat".to_string());
        let target = item
            .target
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&current_target)
            .to_string();
        let source_type = item.source_type.or_else(|| {
            if target == current_target {
                Some("chat".to_string())
            } else {
                None
            }
        });
        let input = store::MemoryInput {
            title: item.title,
            description: description.to_string(),
            target,
            source_type,
            tags: Some(tags),
            importance: Some(importance),
            memory_kind: item.memory_kind,
            confidence: item.confidence,
            stability: item.stability,
        };
        let store = &mut *lock_store(&store)?;
        let memory = store.add_memory(input)?;
        store.record_memory_decision(
            &fingerprint,
            &current_target,
            "saved",
            "accepted_by_policy",
            Some(&memory.title),
            Some(&memory.description),
            Some(memory.importance),
        )?;
        saved += 1;
    }
    let store = &mut *lock_store(&store)?;
    if saved == 0 {
        store.record_memory_decision(
            &fingerprint,
            &current_target,
            "skipped",
            "no_items_passed_policy",
            None,
            Some(latest_user),
            None,
        )?;
    }
    store.mark_memory_ingest_run(&fingerprint, "chat-turn", &current_target)?;
    Ok(saved)
}

fn record_auto_memory_decision(
    store: &Arc<Mutex<store::Store>>,
    fingerprint: &str,
    target: &str,
    action: &str,
    reason: &str,
    item_title: Option<&str>,
    item_description: Option<&str>,
    score: Option<f64>,
) -> Result<(), String> {
    let store = &mut *lock_store(store)?;
    store.record_memory_decision(
        fingerprint,
        target,
        action,
        reason,
        item_title,
        item_description,
        score,
    )
}

fn auto_memory_extractor_prompt() -> String {
    r#"You are a strict long-term memory extractor for a local personal agent.

Return ONLY compact JSON with this exact shape:
{"items":[{"title":"...","description":"...","target":"...","source_type":"chat|file|url|text","tags":["..."],"importance":7.0,"memory_kind":"fact|preference|project_decision|source|todo|note","confidence":0.8,"stability":"temporary|durable|permanent"}]}

Extract at most 3 items. Return {"items":[]} when there is nothing worth remembering.

Save ONLY durable facts that will be useful in future unrelated chats:
- user identity, stable preferences, interests, names, plans, events, commitments;
- important project ideas, architecture decisions, constraints, and TODOs that should persist;
- file paths, URLs, source locations, or text locations the user may need later;
- explicit statements that something is important.

Do NOT save:
- ordinary one-off questions or answers;
- temporary reasoning, implementation chatter, or generic explanations;
- facts invented or inferred by the assistant;
- duplicate memories;
- anything with unclear future value.

Rules:
- Use only facts explicitly present in the latest user message or assistant answer.
- Prefer Russian descriptions when the conversation is Russian.
- If a specific file path, URL, or source target is explicitly present, use it as target and choose source_type accordingly.
- Otherwise use the provided Current chat target and source_type "chat".
- Importance must be 6-10; use 8-10 only for highly reusable facts.
- memory_kind must classify what is being saved.
- confidence is how certain the item is explicitly supported by the conversation.
- stability is "temporary" for short-lived context, "durable" for reusable facts, and "permanent" for identity/preferences that should almost never expire.
"#
    .to_string()
}

fn parse_auto_memory_plan(raw: &str) -> Option<AutoMemoryPlan> {
    serde_json::from_str::<AutoMemoryPlan>(raw.trim())
        .ok()
        .or_else(|| {
            let text = raw.trim();
            if text.starts_with("```") {
                let inner = text
                    .lines()
                    .skip(1)
                    .take_while(|line| !line.trim_start().starts_with("```"))
                    .collect::<Vec<_>>()
                    .join("\n");
                serde_json::from_str::<AutoMemoryPlan>(inner.trim()).ok()
            } else {
                None
            }
        })
        .or_else(|| {
            let start = raw.find('{')?;
            let end = raw.rfind('}')?;
            if end <= start {
                return None;
            }
            serde_json::from_str::<AutoMemoryPlan>(&raw[start..=end]).ok()
        })
}

fn looks_auto_memory_worthy(user: &str, answer: &str) -> bool {
    let combined = format!("{user}\n{answer}");
    let lower = combined.to_lowercase();
    let durable_markers = [
        "важно",
        "запомни",
        "память",
        "проект",
        "идея",
        "архитектур",
        "решили",
        "решение",
        "будем",
        "я хочу",
        "мне нужно",
        "предпочитаю",
        "интерес",
        "зовут",
        "файл",
        "папк",
        "путь",
        ".rs",
        ".ts",
        ".tsx",
        ".md",
        ".pdf",
        "remember",
        "important",
        "project",
        "preference",
        "decision",
        "file",
        "path",
    ];
    durable_markers
        .iter()
        .any(|marker| contains(&lower, marker))
        || (user.chars().count() >= 220 && answer.chars().count() >= 120)
}

fn clip_for_memory_extractor(raw: &str, max_chars: usize) -> String {
    if raw.chars().count() <= max_chars {
        return raw.to_string();
    }
    let mut clipped = raw.chars().take(max_chars).collect::<String>();
    clipped.push_str("\n[truncated]");
    clipped
}

fn chat_target(tree_id: &str, node_id: &str, message_id: &str) -> String {
    if message_id.trim().is_empty() {
        format!("chat://tree/{tree_id}/node/{node_id}")
    } else {
        format!("chat://tree/{tree_id}/node/{node_id}/message/{message_id}")
    }
}

fn auto_memory_fingerprint(target: &str, latest_user: &str, assistant_answer: &str) -> String {
    let mut hasher = DefaultHasher::new();
    "auto-memory-v1".hash(&mut hasher);
    target.hash(&mut hasher);
    latest_user.trim().hash(&mut hasher);
    assistant_answer.trim().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn agent_tool_planner_prompt(
    tree_id: &str,
    node_id: &str,
    workspace_root: &str,
    permission_profile: agent_tools::AgentToolPermissionProfile,
) -> String {
    let permission_summary = agent_tools::permission_profile_summary(permission_profile);
    format!(
        r#"You are the tool planner for ino-agent. Decide whether the latest user request needs local tools.

Return ONLY compact JSON in one of these shapes:
{{"final_answer":"..."}}
{{"tool_calls":[{{"tool":"search_memory","args":{{"query":"...","limit":8}}}}]}}

{permission_summary}

Rules:
- Use only tools allowed by the permission profile.
- Use tools only when the user explicitly asks to search memory, inspect files, run/check/build code, index files, or save memory.
- Prefer search_memory for "remember/найди в памяти/что мы сохраняли" style requests.
- Prefer add_memory only when the user explicitly asks to remember/save a fact and the profile allows it.
- Prefer index_path when the user asks to index, remember a file/folder, or add local files to knowledge and the profile allows it.
- Prefer open_target when the user asks where a memory points or how to open a saved source.
- Prefer list_files/read_file for file inspection.
- Use run_command only for explicit command execution, tests, builds, or local inspection and only when the profile allows it.
- Never request destructive actions. Commands run without shell operators and inside workspace only.
- For chat memories, use target "chat://tree/{tree_id}/node/{node_id}".
- Current workspace root: {workspace_root}
"#
    )
}

fn agent_run_planner_prompt() -> String {
    r#"You are the planning pass for ino-agent's restartable local agent loop.

Return ONLY compact JSON with this exact shape:
{"title":"...","prd":"...","specs":["..."],"tasks":[{"title":"...","description":"..."}]}

Planning rules:
- Create a practical PRD for the user's goal.
- Split the goal into specs, then into atomic tasks.
- Atomic tasks must be small enough to execute one at a time and verify.
- Prefer 4-10 tasks. Use fewer only for tiny goals.
- Include project/file inspection, implementation, verification, docs, and release checks when relevant.
- Do not include dangerous actions such as deletion, overwriting user data, installs, network calls, or git push unless the task says explicit approval is required.
- Write in the user's language.
- Keep task titles short. Task descriptions must be concrete and actionable.
"#
    .to_string()
}

fn agent_run_executor_prompt() -> String {
    r#"You are ino-agent's restartable execution loop.

Execute exactly one atomic task from the current agent run.

Rules:
- Stay inside the current task; do not complete future tasks.
- Use tools only when needed and only within the active permission profile.
- Prefer reading files and running safe build/test/check commands.
- Do not perform destructive actions, dependency installs, network operations, git push, or unknown binary execution.
- If the task cannot be completed safely, mark the result as blocked and explain the required approval or missing input.
- The final response must be concise and structured:
Done:
Evidence:
Next:
"#
    .to_string()
}

fn agent_tool_observer_prompt(
    latest_user: &str,
    tool_results_json: &str,
    remaining: usize,
) -> String {
    format!(
        r#"You are the observer/verifier for an ino-agent tool loop.

The agent already ran tools for the latest request. Decide whether the observations are sufficient.

Return ONLY compact JSON:
{{"tool_calls":[]}}
or
{{"tool_calls":[{{"tool":"read_file","args":{{"path":"..."}}}}]}}

Rules:
- Request more tools only if the current observations are insufficient to answer correctly.
- Do not repeat a tool call that already failed or already returned the needed information.
- Prefer no more tools when the answer can be produced from existing observations.
- At most {remaining} more tool call(s) are allowed.
- Never request destructive actions.
- Latest user request: {latest_user}

Current observations:
```json
{tool_results_json}
```
"#
    )
}

fn agent_answer_verifier_prompt(
    latest_user: &str,
    tool_results_json: &str,
    draft_answer: &str,
) -> String {
    format!(
        r#"You are the verifier for an ino-agent tool-assisted answer.

Return ONLY compact JSON:
{{"answer":"...","issues":[]}}

Verification rules:
- Check the draft answer against the tool results only.
- Keep the answer unchanged when it is supported and directly answers the user.
- Revise the answer only to remove unsupported claims, fix contradictions, mention failed tools plainly, or add missing source/target details that appear in tool results.
- Do not add facts that are absent from the tool results or recent context.
- Preserve the user's language and the answer's useful formatting.
- Do not return Markdown outside the JSON string.

Latest user request:
{latest_user}

Tool results:
```json
{tool_results_json}
```

Draft answer:
```text
{draft_answer}
```
"#
    )
}

fn force_branch_planner_prompt(count: usize) -> String {
    format!(
        "You are a branch planner for a local tree chat app. The user pressed a dedicated Split button, so you MUST create useful child branches from the CURRENT SELECTED NODE, current composer content, attached file, or recent conversation inside that node.\n\nReturn ONLY JSON with this exact shape:\n{{\"should_branch\": true, \"question\": \"\", \"branches\": [{{\"title\": string, \"context\": string}}]}}\n\nThe current node title and description are authoritative. If the current node is already one block inside a broader parent program, split that block into its own subtopics. Do NOT recreate sibling or parent-level branches unless the current node title itself is that broad parent. For example, if the current node is about dynamic programming, create dynamic-programming subtopics; do not create graph/flow/tree branches just because they appeared in the parent context.\n\nCreate COARSE child branches, not one branch per tiny item. Prefer 3-{count} large blocks. If the content is an exam/program/algorithm list, group fine-grained topics under the selected node's domain. If the content is not academic, choose the natural large areas of work inside the selected node. Each title must be concise. Each context must explicitly mention how the child belongs to the current selected node and be specific enough that another assistant call can continue inside that branch without reading the parent chat."
    )
}

fn force_branch_focus_prompt(current_title: &str, current_summary: Option<&str>) -> String {
    let summary = current_summary
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "Empty")
        .unwrap_or("No node description is stored.");
    format!(
        "CURRENT SELECTED NODE TO SPLIT:\nTitle: {current_title}\nDescription: {summary}\n\nHard rule: every branch you create must be a subtopic of this exact node. Use the title and description as the primary source of scope. If recent messages mention broader parent topics or sibling branches, treat them only as background and never split them again."
    )
}

fn wants_agent_tools(raw: &str) -> bool {
    let text = raw.to_lowercase();
    if text.contains("<!-- ino-agent:mode=") {
        return true;
    }
    let memory = [
        "найди в памяти",
        "поиск в памяти",
        "вспомни",
        "что ты помнишь",
        "что сохранено",
        "search memory",
        "recall",
        "индексируй",
        "проиндексируй",
        "добавь файл в память",
        "добавь папку в память",
        "index file",
        "index folder",
        "index path",
    ]
    .iter()
    .any(|needle| contains(&text, needle));
    let files = [
        "прочитай файл",
        "открой файл",
        "посмотри файл",
        "покажи файл",
        "list files",
        "read file",
        "open target",
        "открой источник",
        "куда ссылается",
        "ls ",
        "rg ",
    ]
    .iter()
    .any(|needle| contains(&text, needle));
    let command = [
        "запусти",
        "выполни команду",
        "запусти команду",
        "прогони",
        "собери проект",
        "проверь сборку",
        "run command",
        "run tests",
        "cargo check",
        "npm run",
        "git status",
    ]
    .iter()
    .any(|needle| contains(&text, needle));
    memory || files || command
}

fn remember_request_to_memory_input(
    raw: &str,
    tree_id: &str,
    node_id: &str,
    message_id: &str,
) -> Option<store::MemoryInput> {
    let text = raw.trim();
    if text.chars().count() < 12 {
        return None;
    }
    let lower = text.to_lowercase();
    let markers = [
        "запомни",
        "запомнить:",
        "сохрани в память",
        "добавь в память",
        "remember",
        "save to memory",
    ];
    let marker = markers.iter().find(|marker| lower.contains(**marker))?;
    let start = lower.find(marker)? + marker.len();
    let mut description = text
        .chars()
        .skip(start)
        .collect::<String>()
        .trim_matches([':', '-', '—', ' ', '\n', '\t'])
        .trim()
        .to_string();
    if description.is_empty() && lower.starts_with(marker) {
        description = text.to_string();
    }
    if description.chars().count() < 4 {
        return None;
    }
    Some(store::MemoryInput {
        title: None,
        description,
        target: chat_target(tree_id, node_id, message_id),
        source_type: Some("chat".to_string()),
        tags: Some(vec!["chat".to_string()]),
        importance: Some(7.0),
        memory_kind: Some("note".to_string()),
        confidence: Some(1.0),
        stability: Some("durable".to_string()),
    })
}

fn looks_like_created_branch_list(raw: &str) -> bool {
    let text = raw.to_lowercase();
    contains(&text, "создал отдельные ветки") || contains(&text, "created branches")
}

fn fallback_branch_plan_from_text(source: &str) -> Option<store::BranchPlan> {
    let lines = source.lines().collect::<Vec<_>>();

    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    for line in lines {
        let line = line.trim();
        if line.starts_with("```") {
            continue;
        }
        if line.is_empty() {
            continue;
        }
        let bulletish = line.starts_with('•')
            || line.starts_with("- ")
            || line.starts_with("* ")
            || line.starts_with("— ")
            || line.starts_with("– ")
            || line.starts_with("├")
            || line.starts_with("└")
            || line.starts_with("│")
            || line.starts_with("┌")
            || line.chars().next().is_some_and(|ch| ch.is_ascii_digit());
        let headingish = line.starts_with('#')
            || contains(line, "Блок ")
            || contains(line, "Модуль ")
            || contains(line, "Ветвь ")
            || contains(line, "Branch ")
            || contains(line, "ВАЖНО")
            || contains(line, "ДОП.");
        if !(bulletish || headingish) {
            continue;
        }
        let Some(title) = clean_fallback_branch_title(line) else {
            continue;
        };
        if seen.insert(title.to_lowercase()) {
            candidates.push(title);
        }
    }
    if candidates.len() < 2 {
        return None;
    }

    if let Some(plan) = coarse_fallback_branch_plan(&candidates) {
        return Some(plan);
    }

    let branches: Vec<store::BranchPlanItem> = candidates
        .into_iter()
        .take(7)
        .map(|title| store::BranchPlanItem {
            context: format!(
                "Эта ветка создана из предыдущего ответа как отдельная тема: {title}. Разбирай её отдельно, сохраняя общий контекст родительской ветки."
            ),
            title,
        })
        .collect();
    Some(store::BranchPlan {
        question: format!(
            "Файл включает несколько явно разделенных направлений ({}). Чтобы работа была структурированной, создать ли отдельные ветки для каждого направления?",
            branches
                .iter()
                .map(|branch: &store::BranchPlanItem| branch.title.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ),
        branches,
    })
}

fn coarse_fallback_branch_plan(candidates: &[String]) -> Option<store::BranchPlan> {
    if candidates.len() < 6 {
        return None;
    }

    let groups = [
        (
            "Динамика и рекуррентности",
            &[
                "динами",
                "рекур",
                "подпоследователь",
                "рюкзак",
                "жадн",
                "бинарн",
            ][..],
        ),
        (
            "Графы и пути",
            &[
                "граф",
                "путь",
                "dfs",
                "bfs",
                "компонент",
                "эйлер",
                "гамильтон",
                "кратчайш",
            ][..],
        ),
        (
            "Потоки, паросочетания и остовы",
            &[
                "поток",
                "диниц",
                "паросочет",
                "остов",
                "разрез",
                "flow",
                "matching",
            ][..],
        ),
        (
            "Деревья и декомпозиции",
            &[
                "дерев",
                "lca",
                "heavy",
                "light",
                "декомпози",
                "центроид",
                "treap",
            ][..],
        ),
        (
            "Комбинаторика, матрицы и числа",
            &[
                "комбинатор",
                "матриц",
                "чисел",
                "нод",
                "прост",
                "остат",
                "перестанов",
            ][..],
        ),
        (
            "Строки и последовательности",
            &["строк", "префикс", "суффикс", "бор", "хеш", "z-функ", "кмп"][..],
        ),
        (
            "Геометрия и структуры данных",
            &[
                "геометр",
                "отрез",
                "сегмент",
                "fenwick",
                "heap",
                "куч",
                "множест",
            ][..],
        ),
    ];

    let mut branches = Vec::new();
    for (title, needles) in groups {
        let matched = candidates.iter().any(|candidate| {
            let lower = candidate.to_lowercase().replace('ё', "е");
            needles.iter().any(|needle| contains(&lower, needle))
        });
        if matched {
            branches.push(store::BranchPlanItem {
                title: title.to_string(),
                context: format!(
                    "Крупный блок программы: {title}. Внутри этой ветки группируй родственные мелкие темы из файла и разбирай их как одно направление подготовки."
                ),
            });
        }
    }

    if branches.len() < 2 {
        return None;
    }

    Some(store::BranchPlan {
        question: format!(
            "Файл включает несколько крупных направлений ({}). Чтобы подготовка была структурированной, создать ли отдельные ветки для этих блоков?",
            branches
                .iter()
                .map(|branch| branch.title.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ),
        branches,
    })
}

fn clean_fallback_branch_title(raw: &str) -> Option<String> {
    let mut text = raw.trim().trim_matches('|').trim().to_string();
    for token in ["**", "__", "`", "\r"] {
        text = text.replace(token, "");
    }
    text = text
        .trim_start_matches(|ch: char| {
            ch.is_ascii_digit()
                || ch.is_whitespace()
                || matches!(
                    ch,
                    '.' | ')'
                        | '-'
                        | '*'
                        | '|'
                        | '─'
                        | '━'
                        | '┄'
                        | '├'
                        | '└'
                        | '┌'
                        | '┐'
                        | '┬'
                        | '┴'
                        | '│'
                        | '—'
                        | '–'
                        | '•'
                        | '▪'
                        | '▫'
                        | '◦'
                        | '◆'
                        | '▶'
                        | '▸'
                )
        })
        .trim()
        .to_string();

    while text
        .chars()
        .next()
        .is_some_and(|ch| !ch.is_alphanumeric() && !matches!(ch, '(' | '['))
    {
        text.remove(0);
        text = text.trim_start().to_string();
    }

    if let Some(colon) = text.find(':') {
        if (3..=64).contains(&colon) {
            let prefix = text[..colon].trim().to_lowercase();
            if contains(&prefix, "ветв")
                || contains(&prefix, "branch")
                || contains(&prefix, "лист")
                || contains(&prefix, "node")
                || prefix.chars().any(|ch| ch.is_ascii_digit())
            {
                text = text[colon + 1..].trim().to_string();
            } else {
                text = text[..colon].trim().to_string();
            }
        }
    }
    if let Some(dash) = text.find('—') {
        if (3..=64).contains(&dash) {
            text = text[..dash].trim().to_string();
        }
    }

    let lower = text.to_lowercase();
    if text.chars().count() < 3
        || contains(&lower, "создать")
        || contains(&lower, "создашь")
        || contains(&lower, "нужно развернуть")
        || contains(&lower, "готово")
        || contains(&lower, "контекст ветки")
    {
        return None;
    }
    Some(text.chars().take(96).collect())
}

fn contains(haystack: &str, needle: &str) -> bool {
    haystack.contains(needle)
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

fn clean_extracted_text(value: &str) -> String {
    repair_extracted_text_mojibake(value)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn repair_extracted_text_mojibake(value: &str) -> String {
    let bytes = value
        .chars()
        .map(|ch| {
            let code = ch as u32;
            if code <= 0xff {
                Some(code as u8)
            } else if ch.is_whitespace() {
                Some(b' ')
            } else {
                None
            }
        })
        .collect::<Option<Vec<_>>>();
    let Some(bytes) = bytes else {
        return value.to_string();
    };
    let (decoded, _, _) = WINDOWS_1251.decode(&bytes);
    let decoded = decoded.into_owned();
    if extracted_cyrillic_score(&decoded) > extracted_cyrillic_score(value) + 20 {
        decoded
    } else {
        value.to_string()
    }
}

fn extracted_cyrillic_score(value: &str) -> usize {
    value
        .chars()
        .filter(|ch| ('А'..='я').contains(ch) || matches!(ch, 'Ё' | 'ё' | 'І' | 'і'))
        .count()
}

fn parse_revised_content(answer: &str) -> Result<String, String> {
    for candidate in json_object_candidates(answer) {
        let Ok(parsed) = serde_json::from_str::<Value>(&candidate) else {
            continue;
        };
        if let Some(content) = parsed.get("content").and_then(Value::as_str) {
            let content = content.trim();
            if !content.is_empty() {
                return Ok(content.to_string());
            }
        }
    }
    let trimmed = answer.trim();
    if trimmed.is_empty() {
        Err("The model returned an empty revision.".to_string())
    } else {
        Ok(trimmed.to_string())
    }
}

fn json_object_candidates(answer: &str) -> Vec<String> {
    let trimmed = answer.trim();
    let mut candidates = Vec::new();
    if trimmed.starts_with('{') {
        candidates.push(trimmed.to_string());
    }
    let mut offset = 0;
    while let Some(start_rel) = trimmed[offset..].find('{') {
        let start = offset + start_rel;
        let mut depth = 0_i32;
        let mut in_string = false;
        let mut escaped = false;
        for (index, ch) in trimmed[start..].char_indices() {
            if in_string {
                if escaped {
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == '"' {
                    in_string = false;
                }
                continue;
            }
            match ch {
                '"' => in_string = true,
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        candidates.push(trimmed[start..start + index + ch.len_utf8()].to_string());
                        offset = start + index + ch.len_utf8();
                        break;
                    }
                }
                _ => {}
            }
        }
        if offset <= start {
            break;
        }
    }
    candidates
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = store::Store::new().expect("failed to open local store");
    let store = Arc::new(Mutex::new(store));
    let watcher_store = store.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            store: store.clone(),
        })
        .setup(move |app| {
            start_knowledge_watcher(app.handle().clone(), watcher_store.clone());
            let show = MenuItem::with_id(app, "show", "Show ino-agent", true, None::<&str>)?;
            let new_tree =
                MenuItem::with_id(app, "new_tree", "New Root", true, Some("CmdOrCtrl+N"))?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, Some("CmdOrCtrl+Q"))?;
            let menu = Menu::with_items(
                app,
                &[
                    &show,
                    &new_tree,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?;

            if let Some(icon) = app.default_window_icon().cloned() {
                let app_handle = app.handle().clone();
                let _tray = TrayIconBuilder::new()
                    .icon(icon)
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(move |app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "new_tree" => {
                            let _ = app_handle.emit("tray-new-tree", ());
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_trees,
            create_tree,
            delete_tree,
            set_current_node,
            create_child_node,
            rename_node,
            set_node_color,
            delete_node,
            get_tree_layout,
            get_settings,
            save_settings,
            extract_pdf_text,
            get_messages,
            get_quiz_attempts,
            save_quiz_attempt,
            add_user_message,
            edit_user_message,
            regenerate_assistant_reply,
            generate_assistant_reply,
            confirm_pending_branches,
            force_branch_split,
            run_code,
            check_code,
            list_connectors,
            propose_connector,
            set_connector_enabled,
            revise_assistant_message,
            add_memory,
            update_memory,
            merge_memory,
            search_memory,
            search_knowledge,
            search_page,
            list_memory_recent,
            list_memory_decisions,
            list_memory_review,
            export_memory,
            import_memory,
            delete_memory,
            record_feedback,
            list_feedback_summary,
            get_memory_graph,
            list_watched_paths,
            watch_path,
            unwatch_path,
            poll_watched_paths,
            resolve_target,
            list_project_stacks,
            create_project,
            run_project_command,
            assess_terminal_command,
            run_terminal_command,
            list_terminal_history,
            list_agent_runs,
            create_agent_run,
            advance_agent_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
