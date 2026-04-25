import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

type Tab = { label: string; language: string; code: string };

type CodeBlockProps = {
  language?: string;
  code?: string;
  tabs?: Tab[];
  filename?: string;
};

const HEADER_BG = "#26241f";
const BG = "var(--color-code-bg)";

const codeStyle: Record<string, React.CSSProperties> = {
  ...(vscDarkPlus as Record<string, React.CSSProperties>),
  'pre[class*="language-"]': {
    ...(vscDarkPlus['pre[class*="language-"]'] as React.CSSProperties),
    background: BG,
    margin: 0,
    padding: "16px 18px",
    fontSize: "13px",
    lineHeight: 1.65,
    fontFamily: "var(--font-mono)",
    borderRadius: 0,
  },
  'code[class*="language-"]': {
    ...(vscDarkPlus['code[class*="language-"]'] as React.CSSProperties),
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    background: "transparent",
  },
};

function langDisplay(language: string): string {
  switch (language) {
    case "bash":
    case "sh":
    case "shell":
      return "bash";
    case "ts":
    case "typescript":
      return "typescript";
    case "js":
    case "javascript":
      return "javascript";
    case "json":
      return "json";
    case "yaml":
    case "yml":
      return "yaml";
    case "http":
      return "http";
    default:
      return language;
  }
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      aria-label="Copy code"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function CodeBlock({ language = "text", code, tabs, filename }: CodeBlockProps) {
  const realTabs: Tab[] =
    tabs ?? [{ label: filename ?? langDisplay(language), language, code: code ?? "" }];
  const [active, setActive] = useState(0);
  const current = realTabs[active] ?? realTabs[0];

  return (
    <div className="my-5 overflow-hidden rounded-lg border border-[var(--color-border-strong)] shadow-sm">
      <div
        className="flex items-center justify-between border-b border-white/5 px-3 py-1.5"
        style={{ background: HEADER_BG }}
      >
        <div className="flex items-center gap-1">
          {realTabs.length > 1 ? (
            realTabs.map((tab, i) => (
              <button
                key={tab.label + i}
                type="button"
                onClick={() => setActive(i)}
                className={[
                  "rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                  i === active
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:bg-white/5 hover:text-white/80",
                ].join(" ")}
              >
                {tab.label}
              </button>
            ))
          ) : (
            <span className="font-mono text-[11px] uppercase tracking-wider text-white/45">
              {realTabs[0]?.label}
            </span>
          )}
        </div>
        <CopyButton value={current?.code ?? ""} />
      </div>
      <SyntaxHighlighter
        language={langDisplay(current?.language ?? "text")}
        style={codeStyle}
        wrapLongLines={false}
        customStyle={{ background: BG, margin: 0 }}
      >
        {current?.code ?? ""}
      </SyntaxHighlighter>
    </div>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[0.85em]">
      {children}
    </code>
  );
}
