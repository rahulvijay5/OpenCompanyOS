import type { ReactNode } from "react";

type Inline =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; text: string; href: string };

type Block =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export function prepareAnswerMarkdown(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced?.[1]) {
    text = fenced[1].trim();
  }
  text = text.replace(new RegExp(`\\s*\\(${UUID.source}\\)`, "gi"), "");
  text = text.replace(UUID, "");
  text = text.replace(/[ \t]{2,}/g, " ");
  text = text.replace(/(?<=\S)[ \t]+-\s+(?=\*\*|[A-Z"'])/g, "\n- ");
  return text.trim();
}

function parseInline(input: string): Inline[] {
  const parts: Inline[] = [];
  const pattern =
    /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  for (const match of input.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) {
      parts.push({ type: "text", value: input.slice(last, index) });
    }
    if (match[2]) {
      parts.push({ type: "strong", value: match[2] });
    } else if (match[3]) {
      parts.push({ type: "code", value: match[3] });
    } else if (match[4] && match[5]) {
      parts.push({ type: "link", text: match[4], href: match[5] });
    }
    last = index + match[0].length;
  }
  if (last < input.length) {
    parts.push({ type: "text", value: input.slice(last) });
  }
  return parts;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return parseInline(text).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.type === "strong") {
      return <strong key={key}>{part.value}</strong>;
    }
    if (part.type === "code") {
      return <code key={key}>{part.value}</code>;
    }
    if (part.type === "link") {
      return (
        <a key={key} href={part.href} target="_blank" rel="noreferrer">
          {part.text}
        </a>
      );
    }
    return <span key={key}>{part.value}</span>;
  });
}

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split(/\n/);
  let paragraph: string[] = [];
  let list: string[] = [];

  function flushParagraph() {
    if (paragraph.length === 0) {
      return;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
    paragraph = [];
  }

  function flushList() {
    if (list.length === 0) {
      return;
    }
    blocks.push({ type: "list", items: list });
    list = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{2,3})\s+(.+)$/.exec(trimmed);
    if (heading?.[1] && heading[2]) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: heading[1].length === 2 ? 2 : 3,
        text: heading[2],
      });
      continue;
    }
    const item = /^[-*]\s+(.+)$/.exec(trimmed);
    if (item?.[1]) {
      flushParagraph();
      list.push(item[1]);
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function MarkdownAnswer({ source }: { source: string }) {
  const blocks = parseBlocks(prepareAnswerMarkdown(source));
  if (blocks.length === 0) {
    return null;
  }
  return (
    <div className="md">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Tag = block.level === 2 ? "h3" : "h4";
          return <Tag key={index}>{renderInline(block.text, `h-${index}`)}</Tag>;
        }
        if (block.type === "list") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item, `li-${index}-${itemIndex}`)}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{renderInline(block.text, `p-${index}`)}</p>;
      })}
    </div>
  );
}
