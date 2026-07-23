use crate::store::{BranchPlan, BranchPlanItem, ChatContextMessage, ChatSettings};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use encoding_rs::WINDOWS_1251;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Instant;

const DEFAULT_ENDPOINT: &str = "https://api.openai.com/v1/chat/completions";
const DIRECT_ATTACHMENT_FENCE: &str = "```ino-agent-attachment\n";

pub fn chat_completion(
    settings: &ChatSettings,
    messages: &[ChatContextMessage],
) -> Result<String, String> {
    ensure_settings(settings)?;
    let started = Instant::now();
    let payload = request_payload(settings, messages, false, 0.7);
    let mut child = curl_command(settings, false)
        .arg("--write-out")
        .arg("\n%{http_code}")
        .arg("--data-binary")
        .arg("@-")
        .arg(normalize_endpoint(&settings.endpoint))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start curl: {e}"))?;

    child
        .stdin
        .as_mut()
        .ok_or_else(|| "Failed to open curl stdin.".to_string())?
        .write_all(payload.as_bytes())
        .map_err(|e| e.to_string())?;

    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let split = stdout
        .rfind('\n')
        .ok_or_else(|| format!("API response did not include an HTTP status. {stderr}"))?;
    let body = stdout[..split].trim();
    let status = stdout[split + 1..]
        .trim()
        .parse::<u16>()
        .map_err(|e| format!("Could not parse API status: {e}"))?;

    if status >= 400 {
        return Err(format!("API error {status}: {}", clip(body, 1200)));
    }
    if !output.status.success() && !stderr.is_empty() {
        return Err(stderr);
    }

    let parsed = serde_json::from_str::<Value>(body).map_err(|e| {
        format!(
            "Could not parse API response: {e}. Body: {}",
            clip(body, 800)
        )
    })?;
    log_prompt_cache_usage(&parsed, "completion", started.elapsed().as_millis());
    let content = extract_choice_content(&parsed, false).trim().to_string();
    if content.is_empty() {
        return Err("The model returned an empty answer.".to_string());
    }
    Ok(content)
}

pub fn chat_completion_stream<F>(
    settings: &ChatSettings,
    messages: &[ChatContextMessage],
    mut on_delta: F,
) -> Result<String, String>
where
    F: FnMut(String),
{
    ensure_settings(settings)?;
    let started = Instant::now();
    let payload = request_payload(settings, messages, true, 0.7);
    let mut child = curl_command(settings, true)
        .arg("--data-binary")
        .arg("@-")
        .arg(normalize_endpoint(&settings.endpoint))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start curl: {e}"))?;

    child
        .stdin
        .as_mut()
        .ok_or_else(|| "Failed to open curl stdin.".to_string())?
        .write_all(payload.as_bytes())
        .map_err(|e| e.to_string())?;
    drop(child.stdin.take());

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open curl stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to open curl stderr.".to_string())?;
    let stderr_handle = thread::spawn(move || {
        let mut stderr_text = String::new();
        let mut reader = BufReader::new(stderr);
        let _ = reader.read_to_string(&mut stderr_text);
        stderr_text
    });

    let mut answer = String::new();
    let mut error_lines = Vec::new();
    let mut usage: Option<Value> = None;
    let mut last_raw_delta = String::new();
    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|e| e.to_string())?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if !line.starts_with("data:") {
            error_lines.push(line.to_string());
            continue;
        }

        let data = line.trim_start_matches("data:").trim();
        if data == "[DONE]" {
            break;
        }

        let Ok(parsed) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        if parsed.get("usage").and_then(Value::as_object).is_some() {
            usage = Some(parsed.clone());
        }
        let raw_delta = extract_choice_content(&parsed, true);
        if raw_delta.is_empty() {
            continue;
        }
        let delta = normalize_stream_delta(&answer, &raw_delta, &last_raw_delta);
        last_raw_delta = raw_delta;
        if delta.is_empty() {
            continue;
        }
        answer.push_str(&delta);
        on_delta(delta);
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    let stderr = stderr_handle.join().unwrap_or_default().trim().to_string();
    let answer = answer.trim().to_string();
    if let Some(usage) = usage {
        log_prompt_cache_usage(&usage, "stream", started.elapsed().as_millis());
    }

    if !status.success() && answer.is_empty() {
        let body = error_lines.join("\n");
        if !body.trim().is_empty() {
            return Err(format!("API error: {}", clip(&body, 1200)));
        }
        if !stderr.is_empty() {
            return Err(stderr);
        }
        return Err(format!("curl exited with status {status}"));
    }
    if answer.is_empty() {
        return Err("The model returned an empty answer.".to_string());
    }
    Ok(answer)
}

pub fn parse_branch_plan(answer: &str, limit: usize) -> Option<BranchPlan> {
    let limit = limit.clamp(2, 8);
    for candidate in json_candidates(answer) {
        let Ok(parsed) = serde_json::from_str::<Value>(&candidate) else {
            continue;
        };
        let Some(object) = parsed.as_object() else {
            continue;
        };
        if !object
            .get("should_branch")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return None;
        }

        let source = ["branches", "children", "nodes", "items"]
            .iter()
            .find_map(|key| object.get(*key))
            .and_then(Value::as_array)?;

        let mut branches = Vec::new();
        let mut seen = HashSet::new();
        for item in source {
            let mut title = None;
            let mut context = String::new();
            if let Some(raw) = item.as_str() {
                title = clean_title_from_value(raw);
            } else if let Some(item_object) = item.as_object() {
                if let Some(raw_title) = branch_text_field(item, &["title", "name", "label"]) {
                    title = clean_title_from_value(&raw_title);
                }
                context = branch_text_field(
                    item,
                    &["context", "description", "summary", "focus", "purpose"],
                )
                .unwrap_or_default();
                if context.is_empty() {
                    context = item_object
                        .get("content")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                }
            }

            let Some(title) = title else {
                continue;
            };
            let lower = title.to_lowercase();
            if !seen.insert(lower) {
                continue;
            }
            if context.is_empty() {
                context = format!("Эта ветка выделена для отдельного рассмотрения темы: {title}.");
            }
            branches.push(BranchPlanItem { title, context });
            if branches.len() >= limit {
                break;
            }
        }

        if branches.len() < 2 {
            return None;
        }
        let question = object
            .get("question")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                let names = branches
                    .iter()
                    .map(|branch| branch.title.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(
                    "Похоже, это лучше разложить по отдельным веткам: {names}. Создать отдельные ветки под каждое направление?"
                )
            });
        return Some(BranchPlan { question, branches });
    }
    None
}

fn ensure_settings(settings: &ChatSettings) -> Result<(), String> {
    if settings.api_key.trim().is_empty() {
        return Err("API key is empty. Open chat settings and add your key.".to_string());
    }
    if settings.model.trim().is_empty() {
        return Err("Model is empty. Open chat settings and choose a model.".to_string());
    }
    Ok(())
}

fn request_payload(
    settings: &ChatSettings,
    messages: &[ChatContextMessage],
    stream: bool,
    temperature: f32,
) -> String {
    let api_messages = messages.iter().map(message_to_api_json).collect::<Vec<_>>();
    let mut payload = json!({
        "model": settings.model,
        "messages": api_messages,
        "temperature": temperature,
        "stream": stream,
    });
    if should_use_openai_prompt_cache_hints(&settings.endpoint) {
        payload["prompt_cache_key"] = json!(prompt_cache_key(settings, messages));
        if let Some(retention) = prompt_cache_retention(&settings.model) {
            payload["prompt_cache_retention"] = json!(retention);
        }
        if stream {
            payload["stream_options"] = json!({ "include_usage": true });
        }
    }
    payload.to_string()
}

fn message_to_api_json(message: &ChatContextMessage) -> Value {
    if message.role == "user" {
        if let Some(parts) = content_parts_with_direct_attachments(&message.content) {
            return json!({ "role": message.role, "content": parts });
        }
    }
    json!({ "role": message.role, "content": message.content })
}

fn content_parts_with_direct_attachments(content: &str) -> Option<Vec<Value>> {
    let (text, attachments) = split_direct_attachment_payloads(content);
    if attachments.is_empty() {
        return None;
    }

    let mut parts = Vec::new();
    let mut text = text.trim().to_string();
    for attachment in &attachments {
        if let Some(extracted_text) = attachment_text_fallback(attachment) {
            text.push_str("\n\nPDF text fallback extracted locally from \"");
            text.push_str(&attachment.filename);
            text.push_str(
                "\". Use this text if the model/provider cannot read the attached PDF file directly. Do not infer the file contents from the filename alone.\n\n",
            );
            text.push_str(&extracted_text);
        }
    }
    let text = text.trim();
    parts.push(json!({
        "type": "text",
        "text": if text.is_empty() {
            "The user attached file(s). Analyze them according to the current request.".to_string()
        } else {
            text.to_string()
        },
    }));
    for attachment in attachments {
        let file_data = if attachment.data.starts_with("data:") {
            attachment.data
        } else {
            format!("data:{};base64,{}", attachment.mime, attachment.data)
        };
        parts.push(json!({
            "type": "file",
            "file": {
                "filename": attachment.filename,
                "file_data": file_data,
            },
        }));
    }
    Some(parts)
}

#[derive(Debug)]
struct DirectAttachment {
    filename: String,
    mime: String,
    data: String,
    extracted_text: Option<String>,
}

fn split_direct_attachment_payloads(content: &str) -> (String, Vec<DirectAttachment>) {
    let mut visible = String::new();
    let mut attachments = Vec::new();
    let mut cursor = 0;

    while let Some(relative_start) = content[cursor..].find("[Attached file: ") {
        let start = cursor + relative_start;
        let Some(relative_fence_start) = content[start..].find(DIRECT_ATTACHMENT_FENCE) else {
            break;
        };
        let fence_start = start + relative_fence_start;
        let payload_start = fence_start + DIRECT_ATTACHMENT_FENCE.len();
        let Some(relative_payload_end) = content[payload_start..].find("\n```") else {
            break;
        };
        let payload_end = payload_start + relative_payload_end;
        let block_end = payload_end + "\n```".len();

        visible.push_str(&content[cursor..start]);
        let descriptor = content[start + "[Attached file: ".len()..fence_start]
            .trim()
            .trim_end_matches(']')
            .trim();
        if !descriptor.is_empty() {
            visible.push_str("[Attached file: ");
            visible.push_str(descriptor);
            visible.push_str("]\n");
        }

        if let Some(attachment) = parse_direct_attachment(&content[payload_start..payload_end]) {
            attachments.push(attachment);
        }
        cursor = block_end;
    }

    visible.push_str(&content[cursor..]);
    (visible.trim().to_string(), attachments)
}

fn parse_direct_attachment(payload: &str) -> Option<DirectAttachment> {
    let parsed = serde_json::from_str::<Value>(payload.trim()).ok()?;
    if parsed.get("kind").and_then(Value::as_str) != Some("file") {
        return None;
    }
    let filename = parsed
        .get("filename")
        .and_then(Value::as_str)
        .unwrap_or("attachment.pdf")
        .trim()
        .to_string();
    let mime = parsed
        .get("mime")
        .and_then(Value::as_str)
        .unwrap_or("application/pdf")
        .trim()
        .to_string();
    let data = parsed
        .get("data")
        .and_then(Value::as_str)?
        .trim()
        .to_string();
    if data.is_empty() {
        return None;
    }
    let extracted_text = parsed
        .get("extractedText")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    Some(DirectAttachment {
        filename,
        mime,
        data,
        extracted_text,
    })
}

fn attachment_text_fallback(attachment: &DirectAttachment) -> Option<String> {
    if let Some(extracted_text) = attachment.extracted_text.as_deref() {
        let repaired = clean_pdf_text(extracted_text);
        let extracted_text = repaired.trim();
        if !extracted_text.is_empty() {
            return Some(extracted_text.to_string());
        }
    }
    if !attachment.mime.eq_ignore_ascii_case("application/pdf")
        && !attachment.filename.to_lowercase().ends_with(".pdf")
    {
        return None;
    }
    let bytes = decode_base64_file_data(&attachment.data)?;
    pdf_extract::extract_text_from_mem(&bytes)
        .ok()
        .map(|text| clean_pdf_text(&text))
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn decode_base64_file_data(data: &str) -> Option<Vec<u8>> {
    let payload = data
        .trim()
        .split_once(',')
        .map(|(_, payload)| payload)
        .unwrap_or(data);
    let compact = payload
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>();
    BASE64_STANDARD.decode(compact).ok()
}

fn clean_pdf_text(value: &str) -> String {
    repair_pdf_mojibake(value)
        .replace('\0', "")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn repair_pdf_mojibake(value: &str) -> String {
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
    if cyrillic_score(&decoded) > cyrillic_score(value) + 20 {
        decoded
    } else {
        value.to_string()
    }
}

fn cyrillic_score(value: &str) -> usize {
    value
        .chars()
        .filter(|ch| ('А'..='я').contains(ch) || matches!(ch, 'Ё' | 'ё' | 'І' | 'і'))
        .count()
}

fn should_use_openai_prompt_cache_hints(endpoint: &str) -> bool {
    let endpoint = normalize_endpoint(endpoint).to_lowercase();
    endpoint.contains("api.openai.com") || endpoint.contains("api.aitunnel.ru")
}

fn prompt_cache_retention(model: &str) -> Option<&'static str> {
    let model = model.trim().to_lowercase();
    if model.starts_with("gpt-5.5") {
        return Some("24h");
    }
    if model.starts_with("gpt-5")
        || model.starts_with("gpt-4.1")
        || model.starts_with("gpt-4o")
        || model.starts_with("o1")
        || model.starts_with("o3")
        || model.starts_with("o4")
    {
        return Some("in_memory");
    }
    None
}

fn prompt_cache_key(settings: &ChatSettings, messages: &[ChatContextMessage]) -> String {
    let mut prefix = format!("model:{}\n", settings.model.trim());
    for message in messages
        .iter()
        .take_while(|message| message.role == "system")
    {
        prefix.push_str("system\n");
        prefix.push_str(&message.content);
        prefix.push('\n');
    }
    format!("ino-agent-{:016x}", stable_hash(&prefix))
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn log_prompt_cache_usage(data: &Value, mode: &str, elapsed_ms: u128) {
    let Some(usage) = data.get("usage") else {
        return;
    };
    let prompt_tokens = usage
        .get("prompt_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let cached_tokens = usage
        .get("prompt_tokens_details")
        .and_then(|details| details.get("cached_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    eprintln!(
        "[ino-agent] prompt-cache {mode}: cached_tokens={cached_tokens}, prompt_tokens={prompt_tokens}, elapsed_ms={elapsed_ms}"
    );
}

fn curl_command(settings: &ChatSettings, stream: bool) -> Command {
    let mut command = Command::new("curl");
    command
        .arg("--silent")
        .arg("--show-error")
        .arg("--fail-with-body");
    if stream {
        command.arg("--no-buffer");
    }
    command
        .arg("--location")
        .arg("--max-time")
        .arg("120")
        .arg("--connect-timeout")
        .arg("20")
        .arg("--header")
        .arg("Content-Type: application/json")
        .arg("--header")
        .arg(format!("Authorization: Bearer {}", settings.api_key.trim()));
    command
}

fn normalize_endpoint(endpoint: &str) -> String {
    let trimmed = endpoint.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return DEFAULT_ENDPOINT.to_string();
    }
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

fn extract_choice_content(data: &Value, stream_delta: bool) -> String {
    let Some(choice) = data
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
    else {
        return String::new();
    };
    let message = if stream_delta {
        choice.get("delta").or_else(|| choice.get("message"))
    } else {
        choice.get("message")
    };
    message
        .and_then(|message| message.get("content"))
        .map(extract_text_from_content)
        .unwrap_or_default()
}

fn normalize_stream_delta(answer: &str, raw_delta: &str, last_raw_delta: &str) -> String {
    if raw_delta.is_empty() {
        return String::new();
    }

    if raw_delta.starts_with(answer) {
        return raw_delta[answer.len()..].to_string();
    }

    if raw_delta == last_raw_delta && raw_delta.chars().count() > 1 {
        return String::new();
    }

    let overlap = suffix_prefix_overlap_bytes(answer, raw_delta);
    if overlap_char_count(raw_delta, overlap) >= 3 && overlap < raw_delta.len() {
        return raw_delta[overlap..].to_string();
    }

    raw_delta.to_string()
}

fn suffix_prefix_overlap_bytes(left: &str, right: &str) -> usize {
    let mut best = 0;
    for (index, _) in right.char_indices().skip(1) {
        let prefix = &right[..index];
        if left.ends_with(prefix) {
            best = index;
        }
    }
    if left.ends_with(right) {
        right.len()
    } else {
        best
    }
}

fn overlap_char_count(value: &str, overlap_bytes: usize) -> usize {
    value
        .get(..overlap_bytes)
        .map(|overlap| overlap.chars().count())
        .unwrap_or(0)
}

fn extract_text_from_content(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    let Some(parts) = content.as_array() else {
        return String::new();
    };
    parts
        .iter()
        .filter_map(|part| {
            if let Some(text) = part.as_str() {
                return Some(text.to_string());
            }
            part.get("text")
                .or_else(|| part.get("content"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect::<Vec<_>>()
        .join("")
}

fn json_candidates(answer: &str) -> Vec<String> {
    let trimmed = answer.trim().to_string();
    let mut out = vec![trimmed.clone()];

    for prefix in ["```json", "```"] {
        if let Some(stripped) = trimmed.strip_prefix(prefix) {
            let stripped = stripped
                .strip_suffix("```")
                .unwrap_or(stripped)
                .trim()
                .to_string();
            out.push(stripped);
        }
    }

    if let (Some(start), Some(end)) = (trimmed.find('['), trimmed.rfind(']')) {
        if start < end {
            out.push(trimmed[start..=end].to_string());
        }
    }
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if start < end {
            out.push(trimmed[start..=end].to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{
        clean_pdf_text, content_parts_with_direct_attachments, decode_base64_file_data,
        normalize_stream_delta,
    };

    #[test]
    fn keeps_plain_stream_delta() {
        assert_eq!(normalize_stream_delta("Привет", ", мир", ""), ", мир");
    }

    #[test]
    fn extracts_suffix_from_cumulative_stream_content() {
        assert_eq!(
            normalize_stream_delta("Привет", "Привет, мир", "Привет"),
            ", мир"
        );
    }

    #[test]
    fn ignores_repeated_stream_chunk() {
        assert_eq!(normalize_stream_delta("Привет", "вет", "вет"), "");
    }

    #[test]
    fn trims_overlapping_stream_chunk() {
        assert_eq!(
            normalize_stream_delta("динамическое програм", "программирование", "програм"),
            "мирование"
        );
    }

    #[test]
    fn builds_file_content_part_from_direct_attachment() {
        let content = "Разбери этот файл\n\n[Attached file: lecture.pdf (application/pdf, 12 B)\nNote: PDF sent directly to model]\n\n```ino-agent-attachment\n{\"kind\":\"file\",\"filename\":\"lecture.pdf\",\"mime\":\"application/pdf\",\"size\":12,\"data\":\"JVBERi0=\",\"extractedText\":\"Билет 1. Алгоритмы.\"}\n```";
        let parts = content_parts_with_direct_attachments(content).expect("content parts");

        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0]["type"], "text");
        assert!(parts[0]["text"]
            .as_str()
            .is_some_and(|text| text.contains("Разбери этот файл")));
        assert!(parts[0]["text"]
            .as_str()
            .is_some_and(|text| text.contains("Билет 1. Алгоритмы.")));
        assert_eq!(parts[1]["type"], "file");
        assert_eq!(parts[1]["file"]["filename"], "lecture.pdf");
        assert_eq!(
            parts[1]["file"]["file_data"],
            "data:application/pdf;base64,JVBERi0="
        );
    }

    #[test]
    fn repairs_saved_pdf_extracted_text_before_prompting() {
        let content = "Разбери этот файл\n\n[Attached file: exam.pdf (application/pdf, 12 B)]\n\n```ino-agent-attachment\n{\"kind\":\"file\",\"filename\":\"exam.pdf\",\"mime\":\"application/pdf\",\"size\":12,\"data\":\"JVBERi0=\",\"extractedText\":\"ÝÊÇÀÌÅÍÀÖÈÎÍÍÀß ÏÐÎÃÐÀÌÌÀ\"}\n```";
        let parts = content_parts_with_direct_attachments(content).expect("content parts");

        assert!(
            parts[0]["text"]
                .as_str()
                .is_some_and(|text| text.contains("ЭКЗАМЕНАЦИОННАЯ ПРОГРАММА"))
        );
    }

    #[test]
    fn decodes_raw_and_data_url_file_data() {
        assert_eq!(
            decode_base64_file_data("JVBERi0=").as_deref(),
            Some(&b"%PDF-"[..])
        );
        assert_eq!(
            decode_base64_file_data("data:application/pdf;base64,JVBERi0=").as_deref(),
            Some(&b"%PDF-"[..])
        );
    }

    #[test]
    fn repairs_cp1251_pdf_mojibake() {
        let repaired = clean_pdf_text("ÝÊÇÀÌÅÍÀÖÈÎÍÍÀß ÏÐÎÃÐÀÌÌÀ");
        assert_eq!(repaired, "ЭКЗАМЕНАЦИОННАЯ ПРОГРАММА");
    }
}

fn clean_title_from_value(value: &str) -> Option<String> {
    let mut title = value.trim().to_string();
    title = title
        .trim_start_matches(|ch: char| {
            ch.is_ascii_digit()
                || ch.is_whitespace()
                || matches!(ch, '.' | ')' | '(' | '-' | '*' | '|' | ':' | ';')
        })
        .trim()
        .to_string();
    title = title
        .trim_matches(|ch| matches!(ch, '"' | '\'' | '`'))
        .trim()
        .to_string();
    let title = title.chars().take(96).collect::<String>();
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

fn branch_text_field(item: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        item.get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn clip(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}
