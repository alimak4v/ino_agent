use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use uuid::Uuid;

const DEFAULT_TIMEOUT_MS: u64 = 5_000;
const MAX_TIMEOUT_MS: u64 = 30_000;
const INSTALL_TIMEOUT_MS: u64 = 120_000;
const MAX_OUTPUT_LENGTH: usize = 100_000;
const MAX_DEPENDENCIES: usize = 30;
const MAX_DEPENDENCY_LENGTH: usize = 160;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCodeRequest {
    pub language: String,
    pub code: String,
    pub stdin: Option<String>,
    pub dependencies: Option<Vec<String>>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCodeResponse {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u128,
    pub timed_out: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckCodeRequest {
    pub language: String,
    pub code: String,
    pub tests: Vec<CodeTestCase>,
    pub dependencies: Option<Vec<String>>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeTestCase {
    pub id: String,
    pub input: Vec<Value>,
    pub expected: Value,
    pub hidden: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckCodeResponse {
    pub passed: bool,
    pub passed_count: usize,
    pub total_count: usize,
    pub results: Vec<CodeTestResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeTestResult {
    pub test_id: String,
    pub passed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual: Option<Value>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u128,
    pub hidden: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn run_code(request: RunCodeRequest) -> Result<RunCodeResponse, String> {
    let language = normalize_language(&request.language)?;
    let run_dir = create_run_dir()?;
    let file_name = match language {
        RunnerLanguage::Python => "main.py",
        RunnerLanguage::JavaScript => "main.js",
        RunnerLanguage::Cpp => "main.cpp",
    };
    fs::write(run_dir.join(file_name), request.code).map_err(|e| e.to_string())?;
    let dependencies = normalize_dependencies(request.dependencies.as_deref())?;
    let install = install_dependencies(language, &run_dir, &dependencies);
    if let Err(error) = install {
        let _ = fs::remove_dir_all(&run_dir);
        return Err(error);
    }
    if matches!(language, RunnerLanguage::Cpp) {
        let compile = compile_cpp(&run_dir, file_name);
        match compile {
            Ok(result) if result.success => {}
            Ok(result) => {
                let _ = fs::remove_dir_all(&run_dir);
                return Ok(result);
            }
            Err(error) => {
                let _ = fs::remove_dir_all(&run_dir);
                return Err(error);
            }
        }
    }
    let command = command_for_language(language, file_name, &run_dir);
    let result = execute_process(
        command,
        &run_dir,
        request.stdin.as_deref(),
        timeout_ms(request.timeout_ms),
    );
    let _ = fs::remove_dir_all(&run_dir);
    result
}

pub fn check_code(request: CheckCodeRequest) -> Result<CheckCodeResponse, String> {
    if request.tests.is_empty() {
        return Ok(CheckCodeResponse {
            passed: false,
            passed_count: 0,
            total_count: 0,
            results: Vec::new(),
        });
    }

    let language = normalize_language(&request.language)?;
    let run_dir = create_run_dir()?;
    let tests_json = serde_json::to_string(&request.tests).map_err(|e| e.to_string())?;
    let (file_name, source) = match language {
        RunnerLanguage::Python => ("main.py", python_check_wrapper(&request.code, &tests_json)),
        RunnerLanguage::JavaScript => (
            "main.js",
            javascript_check_wrapper(&request.code, &tests_json),
        ),
        RunnerLanguage::Cpp => return Err("C++ code-task checks are not supported yet.".to_string()),
    };
    fs::write(run_dir.join(file_name), source).map_err(|e| e.to_string())?;
    let dependencies = normalize_dependencies(request.dependencies.as_deref())?;
    let install = install_dependencies(language, &run_dir, &dependencies);
    if let Err(error) = install {
        let _ = fs::remove_dir_all(&run_dir);
        return Err(error);
    }
    let command = command_for_language(language, file_name, &run_dir);
    let run = execute_process(command, &run_dir, None, timeout_ms(request.timeout_ms));
    let _ = fs::remove_dir_all(&run_dir);
    let run = run?;

    let results = if run.timed_out {
        request
            .tests
            .iter()
            .map(|test| failed_test_result(test, "Timed out.", "", "", run.duration_ms))
            .collect()
    } else {
        parse_check_results(&run.stdout).unwrap_or_else(|error| {
            request
                .tests
                .iter()
                .map(|test| {
                    failed_test_result(test, &error, &run.stdout, &run.stderr, run.duration_ms)
                })
                .collect()
        })
    };
    let passed_count = results.iter().filter(|result| result.passed).count();
    Ok(CheckCodeResponse {
        passed: passed_count == request.tests.len(),
        passed_count,
        total_count: request.tests.len(),
        results,
    })
}

#[derive(Debug, Clone, Copy)]
enum RunnerLanguage {
    Python,
    JavaScript,
    Cpp,
}

fn normalize_language(language: &str) -> Result<RunnerLanguage, String> {
    match language.trim().to_lowercase().as_str() {
        "python" | "py" => Ok(RunnerLanguage::Python),
        "javascript" | "js" | "node" => Ok(RunnerLanguage::JavaScript),
        "c++" | "cpp" | "cxx" | "cc" => Ok(RunnerLanguage::Cpp),
        other => Err(format!("Unsupported language: {other}")),
    }
}

fn timeout_ms(value: Option<u64>) -> u64 {
    value.unwrap_or(DEFAULT_TIMEOUT_MS).clamp(1, MAX_TIMEOUT_MS)
}

fn create_run_dir() -> Result<PathBuf, String> {
    let path = std::env::temp_dir()
        .join("ino-agent-runner")
        .join(Uuid::new_v4().to_string());
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn normalize_dependencies(dependencies: Option<&[String]>) -> Result<Vec<String>, String> {
    let Some(dependencies) = dependencies else {
        return Ok(Vec::new());
    };
    if dependencies.len() > MAX_DEPENDENCIES {
        return Err(format!("Too many dependencies. Max: {MAX_DEPENDENCIES}."));
    }
    let mut normalized = Vec::new();
    for dependency in dependencies {
        let dependency = dependency.trim();
        if dependency.is_empty() {
            continue;
        }
        if dependency.len() > MAX_DEPENDENCY_LENGTH {
            return Err(format!(
                "Dependency is too long. Max length: {MAX_DEPENDENCY_LENGTH}."
            ));
        }
        if dependency.chars().any(char::is_control) {
            return Err("Dependency names cannot contain control characters.".to_string());
        }
        if !normalized.iter().any(|item| item == dependency) {
            normalized.push(dependency.to_string());
        }
    }
    Ok(normalized)
}

fn install_dependencies(
    language: RunnerLanguage,
    run_dir: &Path,
    dependencies: &[String],
) -> Result<(), String> {
    if dependencies.is_empty() {
        return Ok(());
    }

    let mut command = match language {
        RunnerLanguage::Python => {
            let package_dir = python_package_dir(run_dir);
            fs::create_dir_all(&package_dir).map_err(|e| e.to_string())?;
            let mut command = Command::new("python3");
            command
                .arg("-m")
                .arg("pip")
                .arg("install")
                .arg("--disable-pip-version-check")
                .arg("--no-input")
                .arg("--target")
                .arg(package_dir);
            command
        }
        RunnerLanguage::JavaScript => {
            fs::write(
                run_dir.join("package.json"),
                r#"{"private":true,"type":"commonjs","dependencies":{}}"#,
            )
            .map_err(|e| e.to_string())?;
            let mut command = Command::new("npm");
            command
                .arg("install")
                .arg("--no-audit")
                .arg("--no-fund")
                .arg("--no-package-lock");
            command
        }
        RunnerLanguage::Cpp => {
            return Err("Installing C++ packages is not supported yet.".to_string());
        }
    };
    command.args(dependencies);
    let result = execute_process(command, run_dir, None, INSTALL_TIMEOUT_MS)?;
    if result.success {
        return Ok(());
    }
    let stderr = format_install_error(&result.stdout, &result.stderr, result.timed_out);
    Err(stderr)
}

fn format_install_error(stdout: &str, stderr: &str, timed_out: bool) -> String {
    let mut message = if timed_out {
        "Dependency installation timed out.".to_string()
    } else {
        "Dependency installation failed.".to_string()
    };
    if !stdout.trim().is_empty() {
        message.push_str("\n\nstdout:\n");
        message.push_str(stdout.trim_end());
    }
    if !stderr.trim().is_empty() {
        message.push_str("\n\nstderr:\n");
        message.push_str(stderr.trim_end());
    }
    message
}

fn python_package_dir(run_dir: &Path) -> PathBuf {
    run_dir.join("python-packages")
}

fn cpp_binary_path(run_dir: &Path) -> PathBuf {
    run_dir.join("main")
}

fn compile_cpp(run_dir: &Path, file_name: &str) -> Result<RunCodeResponse, String> {
    let mut command = Command::new("c++");
    command
        .arg("-std=c++20")
        .arg("-O2")
        .arg("-pipe")
        .arg(file_name)
        .arg("-o")
        .arg(cpp_binary_path(run_dir));
    execute_process(command, run_dir, None, timeout_ms(Some(MAX_TIMEOUT_MS)))
}

fn command_for_language(language: RunnerLanguage, file_name: &str, run_dir: &Path) -> Command {
    let mut command = match language {
        RunnerLanguage::Python => Command::new("python3"),
        RunnerLanguage::JavaScript => Command::new("node"),
        RunnerLanguage::Cpp => Command::new(cpp_binary_path(run_dir)),
    };
    if matches!(language, RunnerLanguage::Python) {
        command.env("PYTHONPATH", python_package_dir(run_dir));
    }
    if !matches!(language, RunnerLanguage::Cpp) {
        command.arg(file_name);
    }
    command
}

fn execute_process(
    mut command: Command,
    dir: &std::path::Path,
    stdin: Option<&str>,
    timeout_ms: u64,
) -> Result<RunCodeResponse, String> {
    let started = Instant::now();
    let mut child = command
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start process: {e}"))?;

    if let Some(input) = stdin {
        if let Some(mut child_stdin) = child.stdin.take() {
            let input = input.to_string();
            thread::spawn(move || {
                let _ = child_stdin.write_all(input.as_bytes());
            });
        }
    } else {
        drop(child.stdin.take());
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture stderr.".to_string())?;
    let stdout_handle = thread::spawn(move || read_limited(stdout));
    let stderr_handle = thread::spawn(move || read_limited(stderr));

    let timeout = Duration::from_millis(timeout_ms);
    let (exit_code, timed_out) = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break (status.code(), false);
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            break (None, true);
        }
        thread::sleep(Duration::from_millis(10));
    };

    let stdout = stdout_handle.join().unwrap_or_default();
    let stderr = stderr_handle.join().unwrap_or_default();
    let success = !timed_out && exit_code == Some(0);
    Ok(RunCodeResponse {
        success,
        stdout,
        stderr,
        exit_code,
        duration_ms: started.elapsed().as_millis(),
        timed_out,
    })
}

fn read_limited(mut reader: impl Read) -> String {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];
    let mut truncated = false;
    loop {
        let Ok(read) = reader.read(&mut buffer) else {
            break;
        };
        if read == 0 {
            break;
        }
        let remaining = MAX_OUTPUT_LENGTH.saturating_sub(output.len());
        if remaining == 0 {
            truncated = true;
            continue;
        }
        let take = remaining.min(read);
        output.extend_from_slice(&buffer[..take]);
        if take < read {
            truncated = true;
        }
    }
    let mut text = String::from_utf8_lossy(&output).to_string();
    if truncated {
        text.push_str("\n[output truncated]");
    }
    text
}

fn parse_check_results(stdout: &str) -> Result<Vec<CodeTestResult>, String> {
    let line = stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .ok_or_else(|| "Checker did not return test results.".to_string())?;
    serde_json::from_str::<Vec<CodeTestResult>>(line)
        .map_err(|e| format!("Could not parse checker output: {e}"))
}

fn failed_test_result(
    test: &CodeTestCase,
    error: &str,
    stdout: &str,
    stderr: &str,
    duration_ms: u128,
) -> CodeTestResult {
    let hidden = test.hidden.unwrap_or(false);
    CodeTestResult {
        test_id: test.id.clone(),
        passed: false,
        input: (!hidden).then(|| test.input.clone()),
        expected: (!hidden).then(|| test.expected.clone()),
        actual: None,
        stdout: stdout.to_string(),
        stderr: stderr.to_string(),
        duration_ms,
        hidden,
        error: Some(error.to_string()),
    }
}

fn python_check_wrapper(user_code: &str, tests_json: &str) -> String {
    format!(
        r#"import contextlib
import io
import json
import time
import traceback

# USER_CODE_START

{user_code}

# USER_CODE_END

tests = {tests_json}
results = []

for test in tests:
    stdout_buffer = io.StringIO()
    stderr_buffer = io.StringIO()
    started = time.perf_counter()
    try:
        with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
            actual = solve(*test["input"])
        expected = test["expected"]
        hidden = bool(test.get("hidden"))
        results.append({{
            "testId": test["id"],
            "passed": actual == expected,
            "input": None if hidden else test["input"],
            "expected": None if hidden else expected,
            "actual": None if hidden else actual,
            "hidden": hidden,
            "stdout": stdout_buffer.getvalue(),
            "stderr": stderr_buffer.getvalue(),
            "durationMs": int((time.perf_counter() - started) * 1000)
        }})
    except Exception as e:
        hidden = bool(test.get("hidden"))
        results.append({{
            "testId": test["id"],
            "passed": False,
            "input": None if hidden else test["input"],
            "expected": None if hidden else test.get("expected"),
            "actual": None,
            "hidden": hidden,
            "error": str(e),
            "stdout": stdout_buffer.getvalue(),
            "stderr": stderr_buffer.getvalue() + traceback.format_exc(),
            "durationMs": int((time.perf_counter() - started) * 1000)
        }})

print(json.dumps(results, ensure_ascii=False, default=str))
"#
    )
}

fn javascript_check_wrapper(user_code: &str, tests_json: &str) -> String {
    format!(
        r#"// USER_CODE_START

{user_code}

// USER_CODE_END

const tests = {tests_json};
const results = [];

function deepEqual(a, b) {{
  return JSON.stringify(a) === JSON.stringify(b);
}}

for (const test of tests) {{
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => stdout.push(args.map(String).join(" "));
  console.error = (...args) => stderr.push(args.map(String).join(" "));
  const started = Date.now();
  try {{
    const actual = solve(...test.input);
    const expected = test.expected;
    const hidden = Boolean(test.hidden);
    results.push({{
      testId: test.id,
      passed: deepEqual(actual, expected),
      input: hidden ? null : test.input,
      expected: hidden ? null : expected,
      actual: hidden ? null : actual,
      hidden,
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
      durationMs: Date.now() - started
    }});
  }} catch (error) {{
    const hidden = Boolean(test.hidden);
    results.push({{
      testId: test.id,
      passed: false,
      input: hidden ? null : test.input,
      expected: hidden ? null : test.expected,
      actual: null,
      hidden,
      error: String(error),
      stdout: stdout.join("\n"),
      stderr: [stderr.join("\n"), error?.stack || String(error)].filter(Boolean).join("\n"),
      durationMs: Date.now() - started
    }});
  }} finally {{
    console.log = originalLog;
    console.error = originalError;
  }}
}}

console.log(JSON.stringify(results));
"#
    )
}
