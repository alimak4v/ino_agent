import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { CodeRunnerBlock } from "./CodeRunnerBlock";
import {
  GraphSteps,
  MermaidDiagram,
  looksLikeGraphStepsSource,
  looksLikeMermaidGraphSource,
} from "./MermaidGraph";
import { RichBlock, richBlockKindFromClass } from "./RichBlocks";

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
          const mermaidDirective = mermaidDirectiveFromClass(className);
          if (mermaidDirective) {
            return <MermaidDiagram graph={`${mermaidDirective}\n${code}`} />;
          }
          if (looksLikeMermaidGraphSource(code)) {
            return <MermaidDiagram graph={code} />;
          }
          if (isGraphStepsClass(className)) {
            return <GraphSteps source={code} />;
          }
          if (looksLikeGraphStepsSource(code)) {
            return <GraphSteps source={code} />;
          }
          const richBlockKind = richBlockKindFromClass(className);
          if (richBlockKind) {
            return <>{RichBlock({ kind: richBlockKind, source: code })}</>;
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
    const withRepairedDelimiters = repairMalformedMathDelimiters(segment);
    const withStandardDelimiters = withRepairedDelimiters
      .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => `\n\n$$\n${math.trim()}\n$$\n\n`)
      .replace(/\\\(([^()\n]*(?:\n(?!\n)[^()\n]*)*)\\\)/g, (_match, math: string) => `$${math.trim()}$`);
    return mapOutsideDollarMath(withStandardDelimiters, normalizeBareLatexFragments);
  });
}

function repairMalformedMathDelimiters(segment: string) {
  return segment
    .replace(/\$([^$\n]*?)\\\)/g, (_match, math: string) => `$${normalizeMathSource(math.trim())}$`)
    .replace(
      /(^|[\s,;:])\\?([A-Z])\s*\\in\s*T\^\{\(([^}\n]+)\}\(V\)\)?/g,
      (_match, prefix: string, symbol: string, indices: string) =>
        `${prefix}$${normalizeMathSource(`${symbol} \\in T^{(${indices}}(V)`)}$`,
    );
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

const LATEX_COMMAND_WORDS = new Set([
  "sqrt",
  "frac",
  "log",
  "sum",
  "prod",
  "in",
  "min",
  "max",
  "left",
  "right",
  "cdot",
  "times",
  "otimes",
  "ldots",
  "dots",
  "cdots",
  "alpha",
  "beta",
  "gamma",
  "delta",
  "theta",
  "lambda",
  "sigma",
  "Omega",
  "Theta",
]);

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

    const math = content.slice(start.index + start.marker.length, end);
    result += `${start.marker}${normalizeMathSource(math)}${start.marker}`;
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

  const withProtectedInlineMath = protectParenthesizedInlineMath(
    withProtectedComplexities,
    protectedMath,
  );
  const withProtectedDisplayLines = protectBareDisplayMathLines(
    withProtectedInlineMath,
    protectedMath,
  );

  return withProtectedDisplayLines
    .replace(
      /((?:[A-Za-z0-9]+[_^]?(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]+)?[+\-*/=<>., ]*)?\\(?:sqrt|frac|log|ln|sum|prod|in|min|max|le|ge|neq|approx|cdot|times|otimes|ldots|dots|cdots|vdots|ddots|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|Omega|omega|Theta)\b(?:\{[^}\n]*\})?(?:\{[^}\n]*\})?)/g,
      (_match, expression: string) => `$${expression.trim()}$`,
    )
    .replace(/@@TREEAI_MATH_(\d+)@@/g, (_match, index: string) => protectedMath[Number(index)] ?? "");
}

function protectParenthesizedInlineMath(segment: string, protectedMath: string[]) {
  let result = "";
  let cursor = 0;

  while (cursor < segment.length) {
    const open = segment.indexOf("(", cursor);
    if (open < 0) {
      result += segment.slice(cursor);
      break;
    }

    result += segment.slice(cursor, open);
    const close = findMatchingParen(segment, open);
    if (close < 0) {
      result += segment.slice(open);
      break;
    }

    const inner = segment.slice(open + 1, close).trim();
    if (looksLikeBareInlineMath(inner)) {
      const token = `@@TREEAI_MATH_${protectedMath.length}@@`;
      protectedMath.push(`$${normalizeMathSource(inner)}$`);
      result += token;
    } else {
      result += segment.slice(open, close + 1);
    }
    cursor = close + 1;
  }

  return result;
}

function findMatchingParen(content: string, open: number) {
  let depth = 0;
  for (let index = open; index < content.length; index += 1) {
    const char = content[index];
    if ((char === "(" || char === ")") && isEscaped(content, index)) continue;
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function looksLikeBareInlineMath(source: string) {
  if (source.length < 3 || source.includes("@@TREEAI_MATH_")) return false;
  if (/[$`\n]/.test(source)) return false;
  if (/[А-Яа-яЁё]/.test(source)) return false;

  const hasLatexCommand = /\\[a-zA-Z]+/.test(source);
  const hasIndices = /[_^](?:\{[^}\n]+\}|[A-Za-z0-9]+)/.test(source);
  const hasRelation = /(?:=|<|>|≈|≤|≥|\\(?:in|le|ge|neq|approx)\b)/.test(source);
  const hasManyMathMarks = (source.match(/[{}_^=\\]/g) ?? []).length >= 3;
  const textWords = source.match(/[A-Za-z]{3,}/g) ?? [];
  const nonCommandWords = textWords.filter((word) => !isLatexCommandWord(word));

  return (
    (hasLatexCommand || hasIndices || hasManyMathMarks) &&
    hasRelation &&
    nonCommandWords.length <= 3
  );
}

function protectBareDisplayMathLines(segment: string, protectedMath: string[]) {
  return segment
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!looksLikeBareDisplayMathLine(trimmed)) return line;

      const token = `@@TREEAI_MATH_${protectedMath.length}@@`;
      protectedMath.push(`$$\n${normalizeMathSource(trimmed)}\n$$`);
      return token;
    })
    .join("\n");
}

function looksLikeBareDisplayMathLine(line: string) {
  if (line.length < 8 || line.includes("@@TREEAI_MATH_")) return false;
  if (/[$`]/.test(line)) return false;
  if (/[А-Яа-яЁё]/.test(line)) return false;

  const hasEquationShape = /[=<>≈≤≥]/.test(line);
  const hasLatexCommand = /\\[a-zA-Z]+/.test(line);
  const hasIndices = /[_^](?:\{[^}\n]+\}|[A-Za-z0-9]+)/.test(line);
  const hasManyMathMarks = (line.match(/[{}_^=\\]/g) ?? []).length >= 3;
  const textWords = line.match(/[A-Za-z]{3,}/g) ?? [];
  const nonCommandWords = textWords.filter((word) => !isLatexCommandWord(word));

  return (
    hasEquationShape &&
    (hasLatexCommand || hasIndices || hasManyMathMarks) &&
    nonCommandWords.length <= 2
  );
}

function isLatexCommandWord(word: string) {
  return LATEX_COMMAND_WORDS.has(word);
}

function normalizeMathSource(source: string) {
  return source
    .replace(/…/g, "\\ldots")
    .replace(/\.\.\./g, "\\ldots ")
    .replace(/\^\{\(([^}\n)]*)\$?\}/g, "^{($1)}")
    .replace(/(?<![\\A-Za-z])([A-Za-z])\{([A-Za-z]_\d[^}\n]*)\}/g, "$1_{$2}")
    .replace(/([)\]])\{([A-Za-z]_\d[^}\n]*)\}/g, "$1_{$2}");
}

function isMermaidClass(className?: string) {
  return /\blanguage-mermaid\b/.test(className ?? "");
}

function mermaidDirectiveFromClass(className?: string) {
  const match = /\blanguage-([a-zA-Z0-9_.+-]+)/.exec(className ?? "");
  const language = match?.[1]?.toLowerCase() ?? "";
  const directives: Record<string, string> = {
    "block-beta": "block-beta",
    blockdiagram: "blockDiagram",
    architecture: "architecture",
    "architecture-beta": "architecture-beta",
    requirementdiagram: "requirementDiagram",
    kanban: "kanban",
    packet: "packet",
    c4context: "C4Context",
    c4container: "C4Container",
    c4component: "C4Component",
    c4dynamic: "C4Dynamic",
    "xychart-beta": "xychart-beta",
    "sankey-beta": "sankey-beta",
  };
  return directives[language] ?? null;
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
    Boolean(mermaidDirectiveFromClass(className)) ||
    looksLikeMermaidGraphSource(source) ||
    isGraphStepsClass(className) ||
    looksLikeGraphStepsSource(source) ||
    Boolean(richBlockKindFromClass(className)) ||
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
