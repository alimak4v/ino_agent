import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { CodeRunnerBlock } from "./CodeRunnerBlock";
import { GraphSteps, MermaidDiagram, looksLikeGraphStepsSource } from "./MermaidGraph";

interface MarkdownMessageProps {
  content: string;
  renderQuiz?: (source: string) => ReactNode;
}

export function MarkdownMessage({ content, renderQuiz }: MarkdownMessageProps) {
  const markdown = normalizeMathDelimiters(content);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        a: ({ children, ...props }) => (
          <a
            {...props}
            className="text-[color:var(--accent)] underline underline-offset-4"
            target="_blank"
            rel="noreferrer"
          >
            {children}
          </a>
        ),
        h1: ({ children }) => <h1 className="mb-3 mt-5 text-2xl font-semibold">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 mt-5 text-xl font-semibold">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 mt-4 text-lg font-semibold">{children}</h3>,
        p: ({ children }) => <p className="my-3 break-words first:mt-0 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="my-3 list-disc space-y-2 pl-6">{children}</ul>,
        ol: ({ children }) => <ol className="my-3 list-decimal space-y-2 pl-6">{children}</ol>,
        li: ({ children }) => <li className="pl-1">{children}</li>,
        hr: () => <hr className="my-6 border-[color:var(--border)]" />,
        blockquote: ({ children }) => (
          <blockquote className="my-4 border-l-2 border-[color:var(--border)] pl-4 text-[color:var(--muted)]">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="my-4 max-w-full overflow-x-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <table className="min-w-full border-separate border-spacing-0 text-left text-sm leading-6">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-[color:var(--panel-soft)] text-[color:var(--text)]">
            {children}
          </thead>
        ),
        tbody: ({ children }) => <tbody className="divide-y divide-[color:var(--border)]">{children}</tbody>,
        tr: ({ children }) => (
          <tr className="transition-colors hover:bg-[color:var(--selected)]/45">{children}</tr>
        ),
        th: ({ children }) => (
          <th className="whitespace-nowrap border-b border-[color:var(--border)] px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.04em] text-[color:var(--muted)] first:pl-4 last:pr-4">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="min-w-[120px] align-top px-3 py-2.5 text-[color:var(--text)] first:pl-4 last:pr-4 [&_p]:my-0">
            {children}
          </td>
        ),
        code: ({ children, className, ...props }) => {
          const code = String(children).replace(/\n$/, "");
          if (isMermaidClass(className)) {
            return <MermaidDiagram graph={code} />;
          }
          if (isGraphStepsClass(className)) {
            return <GraphSteps source={code} />;
          }
          if (looksLikeGraphStepsSource(code)) {
            return <GraphSteps source={code} />;
          }
          if (isQuizClass(className) && renderQuiz) {
            return <>{renderQuiz(code)}</>;
          }
          if (isJsonClass(className) && renderQuiz && looksLikeQuizJson(code)) {
            return <>{renderQuiz(code)}</>;
          }
          if (renderQuiz && looksLikeQuizJson(code)) {
            return <>{renderQuiz(code)}</>;
          }
          const runnableLanguage = runnableLanguageFromClass(className);
          if (runnableLanguage) {
            return <CodeRunnerBlock language={runnableLanguage} code={code} />;
          }
          return (
            <code
              {...props}
              className={`${className ?? ""} break-words rounded-md bg-[color:var(--panel-soft)] px-1.5 py-0.5 text-[0.92em] text-[color:var(--text)]`}
            >
              {children}
            </code>
          );
        },
        pre: ({ children }) => {
          const child = Children.only(children);
          if (isSpecialCodeBlock(child, Boolean(renderQuiz))) {
            return <>{children}</>;
          }
          return (
            <pre className="my-4 max-w-full overflow-x-hidden whitespace-pre-wrap break-words rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-4 text-xs leading-relaxed">
              {children}
            </pre>
          );
        },
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}

function normalizeMathDelimiters(content: string) {
  return mapOutsideCodeFences(content, (segment) => {
    const withStandardDelimiters = segment
      .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => `\n\n$$\n${math.trim()}\n$$\n\n`)
      .replace(/\\\(([^()\n]*(?:\n(?!\n)[^()\n]*)*)\\\)/g, (_match, math: string) => `$${math.trim()}$`);
    return mapOutsideDollarMath(withStandardDelimiters, normalizeBareLatexFragments);
  });
}

function mapOutsideCodeFences(content: string, mapSegment: (segment: string) => string) {
  const lines = content.split(/(\n)/);
  let inFence = false;
  let fenceMarker = "";
  let current = "";
  let result = "";

  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index] ?? "";
    const newline = lines[index + 1] ?? "";
    const fence = /^(\s*)(`{3,}|~{3,})/.exec(line);

    if (fence) {
      if (!inFence) {
        result += mapSegment(current);
        current = "";
        inFence = true;
        fenceMarker = fence[2][0];
      } else if (fence[2][0] === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
      result += line + newline;
      continue;
    }

    if (inFence) {
      result += line + newline;
    } else {
      current += line + newline;
    }
  }

  return result + mapSegment(current);
}

type MathDelimiter = "$" | "$$";

function mapOutsideDollarMath(content: string, mapSegment: (segment: string) => string) {
  let result = "";
  let cursor = 0;

  while (cursor < content.length) {
    const start = findNextMathDelimiter(content, cursor);
    if (!start) {
      result += mapSegment(content.slice(cursor));
      break;
    }

    result += mapSegment(content.slice(cursor, start.index));
    const end = findClosingMathDelimiter(content, start.index + start.marker.length, start.marker);
    if (end < 0) {
      result += mapSegment(content.slice(start.index));
      break;
    }

    result += content.slice(start.index, end + start.marker.length);
    cursor = end + start.marker.length;
  }

  return result;
}

function findNextMathDelimiter(content: string, from: number) {
  for (let index = from; index < content.length; index += 1) {
    if (content[index] !== "$" || isEscaped(content, index)) continue;
    const marker: MathDelimiter = content[index + 1] === "$" ? "$$" : "$";
    return {
      index,
      marker,
    };
  }
  return null;
}

function findClosingMathDelimiter(content: string, from: number, marker: MathDelimiter) {
  for (let index = from; index < content.length; index += 1) {
    if (content.startsWith(marker, index) && !isEscaped(content, index)) {
      return index;
    }
  }
  return -1;
}

function isEscaped(content: string, index: number) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && content[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function normalizeBareLatexFragments(segment: string) {
  const protectedMath: string[] = [];
  const withProtectedComplexities = segment.replace(
    /\bO\(([^()\n]*\\[a-zA-Z]+(?:\{[^}\n]*\})?[^()\n]*)\)/g,
    (_match, inner: string) => {
      const token = `@@TREEAI_MATH_${protectedMath.length}@@`;
      protectedMath.push(`$O(${inner.trim()})$`);
      return token;
    },
  );

  return withProtectedComplexities
    .replace(
      /((?:[A-Za-z0-9]+[_^]?(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]+)?[+\-*/=<>., ]*)?\\(?:sqrt|frac|log|ln|sum|prod|min|max|le|ge|neq|approx|cdot|times|ldots|dots|cdots|vdots|ddots|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|Omega|omega|Theta)\b(?:\{[^}\n]*\})?(?:\{[^}\n]*\})?)/g,
      (_match, expression: string) => `$${expression.trim()}$`,
    )
    .replace(/@@TREEAI_MATH_(\d+)@@/g, (_match, index: string) => protectedMath[Number(index)] ?? "");
}

function isMermaidClass(className?: string) {
  return /\blanguage-mermaid\b/.test(className ?? "");
}

function isGraphStepsClass(className?: string) {
  return /\blanguage-(graphsteps|mermaid-steps)\b/.test(className ?? "");
}

function isQuizClass(className?: string) {
  return /\blanguage-quiz\b/.test(className ?? "");
}

function isJsonClass(className?: string) {
  return /\blanguage-json\b/.test(className ?? "");
}

function looksLikeQuizJson(source: string) {
  try {
    const parsed = JSON.parse(source) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.some(isQuizLikeObject);
    }
    if (!parsed || typeof parsed !== "object") {
      return false;
    }
    const object = parsed as Record<string, unknown>;
    return isQuizLikeObject(object) || Array.isArray(object.questions);
  } catch {
    return false;
  }
}

function isQuizLikeObject(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const object = value as Record<string, unknown>;
  return (
    typeof object.question === "string" &&
    (Array.isArray(object.options) ||
      Array.isArray(object.tests) ||
      "answer" in object ||
      object.type === "code_task")
  );
}

function isSpecialCodeBlock(child: unknown, includeQuiz: boolean) {
  if (!isValidElement(child)) return false;
  const props = child.props as { children?: unknown; className?: unknown };
  const className = typeof props.className === "string" ? props.className : "";
  const source = String(props.children ?? "").replace(/\n$/, "");
  return (
    isMermaidClass(className) ||
    isGraphStepsClass(className) ||
    looksLikeGraphStepsSource(source) ||
    Boolean(runnableLanguageFromClass(className)) ||
    (includeQuiz &&
      (isQuizClass(className) ||
        (isJsonClass(className) && looksLikeQuizJson(source)) ||
        looksLikeQuizJson(source)))
  );
}

function runnableLanguageFromClass(className?: string) {
  const match = /\blanguage-([a-zA-Z0-9_+.-]+)/.exec(className ?? "");
  const language = match?.[1]?.toLowerCase();
  if (language === "python" || language === "py") return "python";
  if (language === "javascript" || language === "js") return "javascript";
  if (language === "cpp" || language === "c++" || language === "cxx" || language === "cc") {
    return "cpp";
  }
  return null;
}
