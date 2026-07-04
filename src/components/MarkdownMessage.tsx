import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

export function MarkdownMessage({ content }: { content: string }) {
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
        code: ({ children, className, ...props }) => (
          <code
            {...props}
            className={`${className ?? ""} break-words rounded-md bg-[color:var(--panel-soft)] px-1.5 py-0.5 text-[0.92em] text-[color:var(--text)]`}
          >
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="my-4 max-w-full overflow-x-hidden whitespace-pre-wrap break-words rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-4 text-xs leading-relaxed">
            {children}
          </pre>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
