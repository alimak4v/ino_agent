use crate::store::{KnowledgeSearchResult, MemoryItem, MemorySearchResult};

pub fn base_assistant_prompt() -> String {
    "You are a helpful assistant inside a local tree-based AI workspace. The user writes only in leaf branches; parent nodes are navigation/context. Answer directly, keep scope from the selected branch path, and do not drift to parent or sibling topics unless asked. If the current branch contains a message starting with \"Контекст ветки\", treat it as the branch contract. Use Markdown. Keep the global context window clean: rely only on provided current context, retrieved memory/knowledge, and recent messages.".to_string()
}

pub fn dynamic_context_modules(
    user_request: &str,
    current_title: &str,
    breadcrumb: &str,
) -> Vec<String> {
    let context = format!("{user_request}\n{current_title}\n{breadcrumb}").to_lowercase();
    let mut modules = Vec::new();
    if wants_scope_expansion_module(&context) {
        modules.push(scope_expansion_prompt());
    }
    if wants_math_module(&context) {
        modules.push(math_rendering_prompt());
    }
    if wants_code_module(&context) {
        modules.push(code_answer_prompt());
    }
    if wants_visual_module(&context) {
        modules.push(visual_rendering_prompt());
    }
    if wants_rich_render_module(&context) {
        modules.push(rich_render_blocks_prompt());
    }
    if wants_quiz_module(&context) {
        modules.push(quiz_rendering_prompt());
    }
    modules
}

pub fn retrieval_context(
    memory_results: &[MemorySearchResult],
    related_memory: &[(MemoryItem, String, f64)],
    knowledge_results: &[KnowledgeSearchResult],
) -> String {
    if memory_results.is_empty() && related_memory.is_empty() && knowledge_results.is_empty() {
        return String::new();
    }

    let lines = memory_results
        .iter()
        .map(|result| {
            format!(
                "- [{}] {} - {} (target: {}; score: {:.2})",
                result.item.source_type,
                result.item.title,
                clip_chars(&result.item.description, 420),
                result.item.target,
                result.score
            )
        })
        .collect::<Vec<_>>();
    let related_lines = related_memory
        .iter()
        .map(|(item, label, weight)| {
            format!(
                "- [{}] {} - {} (target: {}; graph: {}; weight: {:.2})",
                item.source_type,
                item.title,
                clip_chars(&item.description, 360),
                item.target,
                label,
                weight
            )
        })
        .collect::<Vec<_>>();
    let graph_section = if related_lines.is_empty() {
        String::new()
    } else {
        format!(
            "\n\nNearby memory graph nodes. Use them only as supporting context when connected to the query:\n{}",
            related_lines.join("\n")
        )
    };
    let knowledge_lines = knowledge_results
        .iter()
        .map(|result| {
            format!(
                "- [{}] {} - {} (target: {}; offsets: {}-{}; score: {:.2})",
                result.source.source_type,
                result.source.title,
                clip_chars(&result.chunk.text, 520),
                result.chunk.target,
                result.chunk.start_offset,
                result.chunk.end_offset,
                result.score
            )
        })
        .collect::<Vec<_>>();
    let memory_section = if lines.is_empty() {
        String::new()
    } else {
        format!(
            "Relevant global long-term memory across all chats. Use it only when it helps. If you rely on it, mention the target path/location where useful:\n{}{}",
            lines.join("\n"),
            graph_section
        )
    };
    let knowledge_section = if knowledge_lines.is_empty() {
        String::new()
    } else {
        format!(
            "Relevant indexed knowledge chunks. Treat these as source snippets, not personal memory. Cite target path/location when useful:\n{}",
            knowledge_lines.join("\n")
        )
    };
    let mut sections = Vec::new();
    if !memory_section.is_empty() {
        sections.push(memory_section);
    }
    if !knowledge_section.is_empty() {
        sections.push(knowledge_section);
    }
    format!(
        "Global retrieval context for the next answer:\n{}",
        sections.join("\n\n")
    )
}

pub fn is_deictic_topic_request(value: &str) -> bool {
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

pub fn wants_step_graph_response(
    user_request: &str,
    current_title: &str,
    breadcrumb: &str,
) -> bool {
    let request = user_request.to_lowercase();
    let context = format!("{user_request}\n{current_title}\n{breadcrumb}").to_lowercase();
    let asks_visual = [
        "визуал",
        "пошаг",
        "по шаг",
        "итерац",
        "стрел",
        "схем",
        "диаграм",
        "mermaid",
    ]
    .iter()
    .any(|needle| request.contains(needle));
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
    .any(|needle| context.contains(needle));
    asks_visual && algorithm
}

pub fn step_graph_prompt(current_title: &str, breadcrumb: &str, user_request: &str) -> String {
    format!(
        r#"The current request needs an interactive step-by-step Mermaid visualization, but it must stay on the exact selected topic.

SELECTED CONTEXT:
- Current leaf/topic: {current_title}
- Full selected path: {breadcrumb}
- Latest user request: {user_request}

TOPIC SELECTION RULES:
- Infer the exact algorithm/topic from the selected leaf, breadcrumb, latest user request, and recent dialogue.
- Visualize that exact algorithm/topic only.
- Preserve requested coverage. If the user asked for every/each/all items, do not pick one representative item; cover the requested set in prose and use visualization only where it is explicitly requested and fits that scope.
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

fn wants_scope_expansion_module(context: &str) -> bool {
    [
        "распиши",
        "расшарь",
        "разверни",
        "подробнее",
        "раскрой",
        "объясни глубже",
        "кажд",
        "все ",
        "all ",
        "each ",
    ]
    .iter()
    .any(|needle| context.contains(needle))
}

fn wants_math_module(context: &str) -> bool {
    [
        "матриц",
        "matrix",
        "формул",
        "latex",
        "теорем",
        "доказ",
        "интеграл",
        "производн",
        "мера",
        "алгебр",
        "вероятн",
        "\\",
        "$",
    ]
    .iter()
    .any(|needle| context.contains(needle))
}

fn wants_code_module(context: &str) -> bool {
    [
        "код",
        "алгоритм",
        "программ",
        "функц",
        "python",
        "javascript",
        "typescript",
        "rust",
        "c++",
        "cpp",
        "stdin",
        "stdout",
    ]
    .iter()
    .any(|needle| context.contains(needle))
}

fn wants_visual_module(context: &str) -> bool {
    [
        "визуал",
        "схем",
        "диаграм",
        "граф",
        "mermaid",
        "timeline",
        "mindmap",
        "пошаг",
        "по шаг",
    ]
    .iter()
    .any(|needle| context.contains(needle))
}

fn wants_rich_render_module(context: &str) -> bool {
    [
        "матриц",
        "matrix",
        "таблиц",
        "table",
        "доказ",
        "proof",
        "источник",
        "sources",
        "цитат",
        "сравни",
        "compare",
    ]
    .iter()
    .any(|needle| context.contains(needle))
}

fn wants_quiz_module(context: &str) -> bool {
    [
        "тест",
        "quiz",
        "проверь меня",
        "проверку",
        "задай вопросы",
        "экзамен",
        "самопровер",
    ]
    .iter()
    .any(|needle| context.contains(needle))
}

fn scope_expansion_prompt() -> String {
    "Current request asks for expansion or broad coverage. Preserve the requested scope: if the user asks for every/each/all items, cover every visible or attached item instead of choosing one representative example. Use concrete structure, examples, caveats, and next steps when helpful.".to_string()
}

fn math_rendering_prompt() -> String {
    "Math rendering module: wrap formulas and LaTeX commands in $...$ or $$...$$. Do not emit raw LaTeX commands like \\sqrt, \\frac, \\sum, or \\ldots in prose. Use structured notation when it improves clarity.".to_string()
}

fn code_answer_prompt() -> String {
    "Code answer module: when providing runnable code examples, make programs read input from stdin and print to stdout unless the user asks for a self-contained demo. If useful, show a short sample stdin and expected stdout outside the code block.".to_string()
}

fn visual_rendering_prompt() -> String {
    "Visual rendering module: prefer Mermaid diagrams when they clarify structure or process; avoid large ASCII diagrams unless requested. Use fenced ```mermaid blocks for static diagrams. Choose diagram type by meaning: flowchart for processes/graphs, sequenceDiagram for interactions, stateDiagram for states, classDiagram/erDiagram for data models, timeline/gantt for chronology/plans, mindmap for topic maps, xychart/pie for numeric summaries.".to_string()
}

fn rich_render_blocks_prompt() -> String {
    "Rich render block module: use optional typed fenced blocks only when structure improves readability. Supported: ```matrix with JSON {\"rows\":[[...]],\"rowLabels\":[],\"columnLabels\":[]}; ```table with {\"columns\":[],\"rows\":[[...]]}; ```proof with {\"steps\":[{\"claim\":\"...\",\"reason\":\"...\",\"expression\":\"...\"}]}; ```source_list with {\"sources\":[{\"title\":\"...\",\"target\":\"...\",\"quote\":\"...\",\"score\":0.9}]}. Keep block JSON small and do not duplicate the same content in prose.".to_string()
}

fn quiz_rendering_prompt() -> String {
    "Quiz module: if the user asks for a test, quiz, проверку, or \"проверь меня\", include an interactive quiz as fenced ```quiz, not plain JSON and not a bullet list of answers. The block must contain only JSON. Supported types: single_choice, multiple_choice, text. Include explanation and optional points; keep correct answers only inside the quiz JSON.".to_string()
}

fn clip_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    let mut clipped = value
        .chars()
        .take(limit.saturating_sub(1))
        .collect::<String>();
    clipped.push_str("...");
    clipped
}
