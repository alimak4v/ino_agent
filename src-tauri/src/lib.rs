mod api;
mod code_runner;
mod store;

use serde::Serialize;
use std::collections::HashSet;
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, State, Window,
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

const BRANCH_PLAN_ACTION_MARKER: &str = "<!-- treeai:branch-plan -->";

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
) -> Result<store::AssistantReplyResult, String> {
    let store = &mut *lock_store(&state.store)?;
    let plan = store
        .get_pending_branch_plan(&tree_id, &node_id)?
        .ok_or_else(|| "No branch plan is waiting for confirmation.".to_string())?;
    let parent = store.get_node(&tree_id, &node_id)?;
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
    create_branches_from_plan(store, &tree_id, &node_id, &parent_title, &plan)
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
        let mut latest_assistant = String::new();
        for row in rows.iter().rev() {
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
        let parent = store.get_node(&tree_id, &node_id)?;
        let settings = store.get_settings()?;
        let messages = store.build_api_messages_for_node(&tree_id, &node_id)?;
        let pending_plan = store.get_pending_branch_plan(&tree_id, &node_id)?;
        (
            latest_user,
            latest_assistant,
            parent.title,
            settings,
            messages,
            pending_plan,
        )
    };

    let (latest_user, latest_assistant, parent_title, settings, messages, pending_plan) = snapshot;

    if let Some(plan) = pending_plan {
        if is_affirmative(&latest_user) {
            let store = &mut *lock_store(&store)?;
            return create_branches_from_plan(store, &tree_id, &node_id, &parent_title, &plan);
        }
        if is_negative(&latest_user) {
            let store = &mut *lock_store(&store)?;
            store.clear_pending_branch_plan(&tree_id, &node_id)?;
            let message = store.add_message(
                &tree_id,
                &node_id,
                "assistant",
                "Ок, оставляю это в текущей ветке. Продолжаем здесь.",
            )?;
            return Ok(store::AssistantReplyResult {
                message,
                selected_node_id: node_id,
                created_branches: Vec::new(),
            });
        }
    }

    if is_affirmative(&latest_user) {
        if let Some(plan) = fallback_branch_plan_from_text(&latest_assistant) {
            let store = &mut *lock_store(&store)?;
            return create_branches_from_plan(store, &tree_id, &node_id, &parent_title, &plan);
        }
    }

    if wants_branch_creation(&latest_user) && !has_attachment_payload(&latest_user) {
        if let Some(plan) = fallback_branch_plan_from_text(&latest_user) {
            let store = &mut *lock_store(&store)?;
            return save_branch_plan_question(store, &tree_id, &node_id, &plan);
        }
    }

    if looks_branchable(&latest_user) {
        let branch_limit = 7;
        let mut planner_messages = vec![store::ChatContextMessage {
            role: "system".to_string(),
            content: branch_planner_prompt(branch_limit),
        }];
        planner_messages.extend(
            messages
                .iter()
                .filter(|message| message.role != "system")
                .cloned(),
        );

        let mut plan = match api::chat_completion(&settings, &planner_messages) {
            Ok(answer) => api::parse_branch_plan(&answer, branch_limit),
            Err(error) => return Err(error),
        };
        if plan.is_none() || wants_branch_creation(&latest_user) {
            let fallback = fallback_branch_plan_from_text(&latest_user)
                .or_else(|| fallback_branch_plan_from_text(&latest_assistant));
            if let Some(fallback_plan) = fallback {
                if plan.is_none() {
                    plan = Some(fallback_plan);
                }
            }
        }

        if let Some(plan) = plan {
            let store = &mut *lock_store(&store)?;
            if wants_branch_creation(&latest_user) {
                return create_branches_from_plan(store, &tree_id, &node_id, &parent_title, &plan);
            }
            return save_branch_plan_question(store, &tree_id, &node_id, &plan);
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
        store.add_message(&tree_id, &node_id, "assistant", &answer)?
    };
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
    let content = format!("{}\n\n{}", plan.question, BRANCH_PLAN_ACTION_MARKER);
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

fn branch_planner_prompt(count: usize) -> String {
    format!(
        "You are a strict branch-planning classifier for a local tree chat app. Decide whether the latest user request truly needs separate child branches.\n\nReturn ONLY JSON with this exact shape:\n{{\"should_branch\": boolean, \"question\": string, \"branches\": [{{\"title\": string, \"context\": string}}]}}\n\nSet should_branch=true whenever the request, pasted text, file, plan, project, research idea, study program, comparison, or broad problem would be cleaner as several independent subtopics that can be explored separately without polluting one chat. This is not limited to PDFs: any multi-topic content should be considered. If the latest user explicitly asks to create/split/separate branches or topics, set should_branch=true unless the conversation has no separable topics.\n\nSet should_branch=false for ordinary single-topic questions, single algorithm explanations, short follow-ups, simple clarifications, or lists that are small enough to answer in one message.\n\nWhen branching, create COARSE top-level branches, not one branch per tiny item. Prefer 3-{count} large blocks. For exam/program files, use blocks such as dynamic programming, graphs, flows/matchings, trees/decompositions, math/combinatorics, strings/geometry when those fit. For non-academic content, choose the natural large areas of work. Preserve explicit top-level sections/headings/modules when the source has them, but group fine-grained items under larger directions. Each title must be concise. Each context must explain what that branch is about so another assistant call can understand the branch focus.\n\nThe question must be one concise Russian paragraph in this style: \"Здесь есть несколько крупных направлений (...). Чтобы разбирать их отдельно и не смешивать контекст, создать отдельные ветки для этих блоков?\" Do not include a bullet list in the question. If should_branch=false, use an empty branches array and an empty question."
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

fn is_affirmative(raw: &str) -> bool {
    let text = normalize_reply(raw);
    let tokens = text.split_whitespace().collect::<HashSet<_>>();
    matches!(
        text.as_str(),
        "да" | "ага"
            | "угу"
            | "ок"
            | "окей"
            | "yes"
            | "y"
            | "sure"
            | "давай"
            | "конечно"
            | "подтверждаю"
            | "согласен"
            | "согласна"
            | "можно"
            | "го"
    ) || tokens.iter().any(|token| {
        matches!(
            *token,
            "да" | "ага"
                | "угу"
                | "ок"
                | "окей"
                | "yes"
                | "y"
                | "sure"
                | "давай"
                | "конечно"
                | "подтверждаю"
                | "согласен"
                | "согласна"
                | "можно"
                | "го"
        )
    }) || wants_branch_creation(&text)
        || (contains(&text, "делай") && contains(&text, "вет"))
        || (contains(&text, "создавай") && contains(&text, "вет"))
}

fn is_negative(raw: &str) -> bool {
    matches!(
        normalize_reply(raw).as_str(),
        "нет" | "не" | "no" | "n" | "не надо" | "не нужно" | "оставь так"
    )
}

fn wants_branch_creation(raw: &str) -> bool {
    let text = raw.to_lowercase();
    let action = [
        "создай",
        "создашь",
        "создать",
        "сделай",
        "разбей",
        "разбить",
        "раздели",
        "разделить",
        "разложи",
        "раскидай",
        "оформи",
    ]
    .iter()
    .any(|needle| contains(&text, needle));
    let target = [
        "ветк",
        "отдельн",
        "тем",
        "модул",
        "блок",
        "направлен",
        "категор",
        "сфер",
        "част",
    ]
    .iter()
    .any(|needle| contains(&text, needle));
    action && target
}

fn looks_branchable(raw: &str) -> bool {
    let text = raw.to_lowercase();
    let char_count = text.chars().count();
    if is_negative(&text) || is_affirmative(&text) {
        return false;
    }
    if wants_branch_creation(&text) {
        return true;
    }
    if char_count < 24 {
        return false;
    }
    if has_attachment_payload(&text) {
        return true;
    }
    let many = [
        "несколько",
        "много",
        "разные",
        "разных",
        "варианты",
        "идеи",
        "темы",
        "темам",
        "тем",
        "сферы",
        "направления",
        "категории",
        "модули",
        "модул",
        "блоки",
        "блок",
        "разложи",
        "разбери",
        "сравни",
    ]
    .iter()
    .any(|needle| contains(&text, needle));
    let split = [
        "отдельно",
        "по отдельности",
        "ветк",
        "кажд",
        "сфер",
        "направлен",
        "категор",
        "стартап",
        "предмет",
        "блок",
    ]
    .iter()
    .any(|needle| contains(&text, needle));
    let structure_hint = text.lines().filter(|line| !line.trim().is_empty()).count() >= 3
        || text.matches(';').count() >= 2
        || text.matches(',').count() >= 4
        || text.matches(" и ").count() >= 3
        || text.matches(" или ").count() >= 2;
    let broad_task = [
        "план",
        "проект",
        "иде",
        "исслед",
        "курс",
        "програм",
        "подготов",
        "стратег",
        "архитект",
        "продукт",
        "стартап",
        "разбор",
        "обуч",
        "roadmap",
        "research",
    ]
    .iter()
    .any(|needle| contains(&text, needle));

    (many && split)
        || (structure_hint && char_count >= 60)
        || (broad_task && char_count >= 90)
        || char_count >= 180
}

fn has_attachment_payload(raw: &str) -> bool {
    contains(&raw.to_lowercase(), "[attached file:")
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

fn normalize_reply(raw: &str) -> String {
    raw.trim()
        .to_lowercase()
        .replace('ё', "е")
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || ch.is_whitespace() {
                ch
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn contains(haystack: &str, needle: &str) -> bool {
    haystack.contains(needle)
}

fn clean_extracted_text(value: &str) -> String {
    value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = store::Store::new().expect("failed to open local store");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            store: Arc::new(Mutex::new(store)),
        })
        .setup(|app| {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
