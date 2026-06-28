mod api;
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
fn get_messages(
    state: State<AppState>,
    tree_id: String,
    node_id: String,
) -> Result<Vec<store::Message>, String> {
    lock_store(&state.store)?.get_messages_for_path(&tree_id, &node_id)
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

fn generate_assistant_reply_blocking(
    window: Window,
    store: Arc<Mutex<store::Store>>,
    tree_id: String,
    node_id: String,
    request_id: String,
) -> Result<store::AssistantReplyResult, String> {
    let snapshot = {
        let store = lock_store(&store)?;
        let rows = store.get_messages_for_path(&tree_id, &node_id)?;
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
            store.clear_pending_branch_plan(&tree_id, &node_id)?;
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
        lock_store(&store)?.clear_pending_branch_plan(&tree_id, &node_id)?;
    }

    if is_affirmative(&latest_user) {
        if let Some(plan) = fallback_branch_plan_from_text(&latest_assistant) {
            let store = &mut *lock_store(&store)?;
            return create_branches_from_plan(store, &tree_id, &node_id, &parent_title, &plan);
        }
    }

    if looks_branchable(&latest_user) {
        let create_immediately = wants_branch_creation(&latest_user);
        let mut planner_messages = vec![store::ChatContextMessage {
            role: "system".to_string(),
            content: branch_planner_prompt(5),
        }];
        planner_messages.extend(
            messages
                .iter()
                .filter(|message| message.role != "system")
                .cloned(),
        );

        let mut plan = match api::chat_completion(&settings, &planner_messages) {
            Ok(answer) => api::parse_branch_plan(&answer, 5),
            Err(error) => {
                if create_immediately {
                    None
                } else {
                    return Err(error);
                }
            }
        };
        if plan.is_none() && create_immediately {
            plan = fallback_branch_plan_from_text(&latest_assistant)
                .or_else(|| fallback_branch_plan_from_text(&latest_user));
        }

        if let Some(plan) = plan {
            if create_immediately {
                let store = &mut *lock_store(&store)?;
                return create_branches_from_plan(store, &tree_id, &node_id, &parent_title, &plan);
            }

            let store = &mut *lock_store(&store)?;
            store.save_pending_branch_plan(&tree_id, &node_id, &plan)?;
            let message = store.add_message(&tree_id, &node_id, "assistant", &plan.question)?;
            return Ok(store::AssistantReplyResult {
                message,
                selected_node_id: node_id,
                created_branches: Vec::new(),
            });
        }

        if create_immediately {
            let store = &mut *lock_store(&store)?;
            let message = store.add_message(
                &tree_id,
                &node_id,
                "assistant",
                "Я не нашёл в предыдущем контексте достаточно отдельных тем, чтобы создать ветки. Пришли список тем или попроси разбить конкретный ответ.",
            )?;
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
    let store = &mut *lock_store(&store)?;
    let message = store.add_message(&tree_id, &node_id, "assistant", &answer)?;
    Ok(store::AssistantReplyResult {
        message,
        selected_node_id: node_id,
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
    let mut created = Vec::new();
    for item in &plan.branches {
        let child_id = store.create_child_node(tree_id, node_id, item.title.clone())?;
        store.add_message(
            tree_id,
            &child_id,
            "assistant",
            &branch_context_message(parent_title, item),
        )?;
        created.push(store::AiBranchCreated {
            id: child_id,
            title: item.title.clone(),
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
    let message = store.add_message(tree_id, node_id, "assistant", &content)?;
    let selected_node_id = created
        .first()
        .map(|branch| branch.id.clone())
        .unwrap_or_else(|| node_id.to_string());
    store.set_last_node(tree_id, &selected_node_id)?;
    Ok(store::AssistantReplyResult {
        message,
        selected_node_id,
        created_branches: created,
    })
}

fn branch_context_message(parent_title: &str, item: &store::BranchPlanItem) -> String {
    format!(
        "Контекст ветки: {}\n\nЭта ветка создана как отдельное направление внутри родительской ветки \"{}\".\n\nЧто здесь рассматриваем: {}\n\nПродолжай диалог в этой ветке, удерживая фокус именно на этом направлении и опираясь на общий контекст родительской ветки.",
        item.title, parent_title, item.context
    )
}

fn branch_planner_prompt(count: usize) -> String {
    format!(
        "You are a strict branch-planning classifier for a local tree chat app. Decide whether the latest user request truly needs separate child branches.\n\nReturn ONLY JSON with this exact shape:\n{{\"should_branch\": boolean, \"question\": string, \"branches\": [{{\"title\": string, \"context\": string}}]}}\n\nSet should_branch=true only when the user asks for multiple independent topics, categories, spheres, directions, startup areas, plans, modules, blocks, or alternatives that would be meaningfully discussed separately in different branches. If the latest user explicitly asks to create/split/separate branches or topics, set should_branch=true unless the conversation has no separable topics. Do not branch for ordinary questions, single-topic explanations, short follow-ups, or simple lists that can be answered in one message.\n\nIf should_branch=true, create 2-{count} branches. Each title must be concise. Each context must explain what that branch is about so another assistant call can understand the branch focus. The question must be in Russian and ask the user whether to create those separate branches. If should_branch=false, use an empty branches array and an empty question."
    )
}

fn is_affirmative(raw: &str) -> bool {
    let text = normalize_reply(raw);
    matches!(
        text.as_str(),
        "да" | "ага" | "угу" | "ок" | "окей" | "yes" | "y" | "sure" | "давай" | "конечно"
    ) || (contains(&text, "создай") && contains(&text, "вет"))
        || (contains(&text, "сделай") && contains(&text, "вет"))
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
    if is_negative(&text) || text.chars().count() < 24 || is_affirmative(&text) {
        return false;
    }
    if wants_branch_creation(&text) {
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
    many && split
}

fn fallback_branch_plan_from_text(source: &str) -> Option<store::BranchPlan> {
    let mut lines = source.lines().collect::<Vec<_>>();
    if lines.len() > 80 {
        lines = lines[lines.len() - 80..].to_vec();
    }

    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    let mut in_code = false;
    for line in lines {
        let line = line.trim();
        if line.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if in_code || line.is_empty() {
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

    let branches = candidates
        .into_iter()
        .take(8)
        .map(|title| store::BranchPlanItem {
            context: format!(
                "Эта ветка создана из предыдущего ответа как отдельная тема: {title}. Разбирай её отдельно, сохраняя общий контекст родительской ветки."
            ),
            title,
        })
        .collect();
    Some(store::BranchPlan {
        question: "Создать отдельные ветки под эти темы?".to_string(),
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
        .trim_matches(|ch: char| ch.is_ascii_punctuation() || ch.is_whitespace())
        .to_lowercase()
}

fn contains(haystack: &str, needle: &str) -> bool {
    haystack.contains(needle)
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
            let show = MenuItem::with_id(app, "show", "Show treeAI", true, None::<&str>)?;
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
            delete_node,
            get_tree_layout,
            get_settings,
            save_settings,
            get_messages,
            add_user_message,
            generate_assistant_reply,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
