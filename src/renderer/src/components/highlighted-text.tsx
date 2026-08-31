import { ReactNode } from "react";

interface Span {
  start: number;
  end: number;
}

// Several patterns can hit the same characters, so overlapping spans are merged
// before rendering; otherwise the nested marks paint over each other.
const mergedSpans = (text: string, patterns: RegExp[]): Span[] => {
  const spans: Span[] = [];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match[0].length === 0) {
        pattern.lastIndex++;
        continue;
      }
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  if (spans.length === 0) return spans;
  spans.sort((a, b) => a.start - b.start);

  const merged: Span[] = [spans[0]];
  for (const span of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push(span);
  }
  return merged;
};

export const HighlightedText = ({ text, patterns }: { text: string; patterns: RegExp[] }) => {
  if (patterns.length === 0 || !text) return <>{text}</>;

  const spans = mergedSpans(text, patterns);
  if (spans.length === 0) return <>{text}</>;

  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const span of spans) {
    if (span.start > cursor) parts.push(text.slice(cursor, span.start));
    parts.push(
      <mark key={span.start} className="bg-yellow-400/60 text-inherit rounded-[2px] px-px">
        {text.slice(span.start, span.end)}
      </mark>
    );
    cursor = span.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <>{parts}</>;
};
