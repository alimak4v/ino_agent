import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type CodeLanguage, type RunCodeResponse } from "../lib/api";

interface CodeRunnerBlockProps {
  language: CodeLanguage;
  code: string;
}

export function CodeRunnerBlock({ language, code }: CodeRunnerBlockProps) {
  const [value, setValue] = useState(code);
  const [stdin, setStdin] = useState("");
  const [dependencies, setDependencies] = useState("");
  const [result, setResult] = useState<RunCodeResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const title = useMemo(() => languageLabel(language), [language]);

  useLayoutEffect(() => {
    const textarea = codeRef.current;
    if (!textarea || !editing) return;
    const maxVisibleLines = 100;
    const lineHeight = 20;
    const verticalPadding = 24;
    const maxHeight = maxVisibleLines * lineHeight + verticalPadding;

    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${Math.max(180, nextHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [editing, value]);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setError("");
    try {
      setResult(
        await api.runCode({
          language,
          code: value,
          stdin,
          dependencies: parseDependencies(dependencies),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="my-4 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--code-bg)] text-[13px] leading-5 shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border)] px-4 py-2">
        <span className="text-[12px] font-medium text-[color:var(--muted)]">{title}</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={running}
            onClick={() => void run()}
            className="inline-flex h-8 items-center justify-center rounded-full bg-[color:var(--button)] px-4 text-xs font-medium text-[color:var(--button-text)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? "Running" : "Run"}
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => setEditing((current) => !current)}
            className="inline-flex h-8 items-center justify-center rounded-full px-3 text-xs font-medium text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {editing ? "Done" : "Edit"}
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => {
              setValue(code);
              setResult(null);
              setError("");
            }}
            className="inline-flex h-8 items-center justify-center rounded-full px-3 text-xs font-medium text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(value)}
            className="inline-flex h-8 items-center justify-center rounded-full px-3 text-xs font-medium text-[color:var(--muted)] transition-colors hover:bg-[color:var(--selected)] hover:text-[color:var(--text)]"
          >
            Copy
          </button>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {editing ? (
          <textarea
            ref={codeRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            spellCheck={false}
            className="min-h-[180px] w-full resize-y rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] p-3 font-mono text-[12px] leading-5 text-[color:var(--text)] outline-none transition-shadow focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)]"
          />
        ) : (
          <HighlightedCode language={language} code={value} />
        )}
        <textarea
          value={stdin}
          onChange={(event) => setStdin(event.target.value)}
          spellCheck={false}
          placeholder="stdin"
          className="min-h-[58px] w-full resize-y rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] p-3 font-mono text-[12px] leading-5 text-[color:var(--text)] outline-none transition-shadow placeholder:text-[color:var(--muted)] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)]"
        />
        {language !== "cpp" && (
          <input
            value={dependencies}
            onChange={(event) => setDependencies(event.target.value)}
            spellCheck={false}
            placeholder={dependencyPlaceholder(language)}
            className="h-10 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] px-3 font-mono text-[12px] text-[color:var(--text)] outline-none transition-shadow placeholder:text-[color:var(--muted)] focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)]"
          />
        )}

        {result && (
          <div className="space-y-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] p-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--muted)]">
              <span className={result.success ? "text-emerald-600" : "text-rose-600"}>
                {result.success ? "success" : result.timedOut ? "timed out" : "failed"}
              </span>
              <span>exit code: {result.exitCode ?? "null"}</span>
              <span>{result.durationMs} ms</span>
            </div>
            <OutputPanel label="stdout" value={result.stdout} />
            <OutputPanel label="stderr" value={result.stderr} />
          </div>
        )}

        {error && <div className="text-xs text-red-600">{error}</div>}
      </div>
    </section>
  );
}

function OutputPanel({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">
        {label}
      </div>
      <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[color:var(--border)] bg-[color:var(--code-bg)] p-3 font-mono text-[12px] leading-5 text-[color:var(--code-text)]">
        {value || " "}
      </pre>
    </div>
  );
}

function languageLabel(language: CodeLanguage) {
  if (language === "python") return "Python";
  if (language === "javascript") return "JavaScript";
  return "C++";
}

function dependencyPlaceholder(language: CodeLanguage) {
  if (language === "python") return "packages: numpy, requests==2.32.3";
  return "packages: lodash, dayjs@1";
}

function HighlightedCode({ language, code }: { language: CodeLanguage; code: string }) {
  const lineHeight = 20;
  const verticalPadding = 24;
  const maxHeight = 100 * lineHeight + verticalPadding;

  return (
    <pre
      style={{ maxHeight }}
      className="m-0 min-h-[180px] overflow-auto rounded-xl bg-transparent p-0 font-mono text-[13px] leading-6 text-[color:var(--code-text)]"
    >
      <code>{highlightCode(code, language)}</code>
    </pre>
  );
}

function highlightCode(code: string, language: CodeLanguage): ReactNode[] {
  const rules = highlightRules(language);
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(rules.map((rule) => `(${rule.pattern.source})`).join("|"), "gm");
  let index = 0;
  let key = 0;

  for (const match of code.matchAll(pattern)) {
    const text = match[0];
    const start = match.index ?? 0;
    if (start > index) {
      nodes.push(code.slice(index, start));
    }
    const ruleIndex = match.slice(1).findIndex(Boolean);
    const className = rules[ruleIndex]?.className;
    nodes.push(
      className ? (
        <span key={key++} className={className}>
          {text}
        </span>
      ) : (
        text
      ),
    );
    index = start + text.length;
  }

  if (index < code.length) {
    nodes.push(code.slice(index));
  }
  return nodes;
}

function highlightRules(language: CodeLanguage) {
  const strings = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/;
  const numbers = /\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)\b/;
  const cppKeywords =
    /\b(?:alignas|alignof|auto|bool|break|case|catch|char|class|const|constexpr|continue|default|delete|do|double|else|enum|explicit|extern|false|float|for|friend|if|inline|int|long|namespace|new|nullptr|operator|private|protected|public|return|short|signed|sizeof|static|std|string|struct|switch|template|this|throw|true|try|typename|using|void|while|vector)\b/;
  const jsKeywords =
    /\b(?:async|await|break|case|catch|class|const|continue|default|delete|do|else|export|false|finally|for|from|function|if|import|in|let|new|null|return|switch|this|throw|true|try|typeof|undefined|var|while)\b/;
  const pyKeywords =
    /\b(?:and|as|assert|break|class|continue|def|elif|else|except|False|finally|for|from|if|import|in|is|lambda|None|not|or|pass|raise|return|True|try|while|with|yield)\b/;

  if (language === "python") {
    return [
      { pattern: /#[^\n]*/, className: "text-[color:var(--code-comment)]" },
      { pattern: strings, className: "text-[color:var(--code-string)]" },
      { pattern: pyKeywords, className: "font-semibold text-[color:var(--code-keyword)]" },
      { pattern: numbers, className: "text-[color:var(--code-number)]" },
    ];
  }

  return [
    { pattern: /\/\/[^\n]*|\/\*[\s\S]*?\*\//, className: "text-[color:var(--code-comment)]" },
    { pattern: /^#[^\n]*/, className: "font-semibold text-[color:var(--code-preprocessor)]" },
    { pattern: strings, className: "text-[color:var(--code-string)]" },
    {
      pattern: language === "cpp" ? cppKeywords : jsKeywords,
      className: "font-semibold text-[color:var(--code-keyword)]",
    },
    { pattern: numbers, className: "text-[color:var(--code-number)]" },
  ];
}

function parseDependencies(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
