import { ReactNode } from "react";
import { useSetAtom } from "jotai";
import { searchModeAtom, searchQueryAtom } from "@renderer/lib/atom";
import { redactionTokenPattern } from "@renderer/lib/log-entities";
import { HighlightedText } from "./highlighted-text";

const TOKEN = redactionTokenPattern();

/**
 * A message with Chrome's redaction tokens made clickable: picking one filters
 * the log to every line naming the same address, account or device.
 */
export const RedactedText = ({ text, patterns }: { text: string; patterns: RegExp[] }) => {
  const setQuery = useSetAtom(searchQueryAtom);
  const setMode = useSetAtom(searchModeAtom);

  if (!text.includes("(")) return <HighlightedText text={text} patterns={patterns} />;

  const parts: ReactNode[] = [];
  let cursor = 0;
  TOKEN.lastIndex = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      parts.push(
        <HighlightedText key={cursor} text={text.slice(cursor, start)} patterns={patterns} />
      );
    }
    const token = match[0];
    parts.push(
      <span
        key={`t${start}`}
        role="button"
        tabIndex={-1}
        title="Show every line with this token"
        className="cursor-pointer underline decoration-dotted decoration-primary/60 underline-offset-2 hover:text-primary"
        onClick={(event) => {
          event.stopPropagation();
          setQuery(`"${token}"`);
          setMode("filter");
        }}
      >
        <HighlightedText text={token} patterns={patterns} />
      </span>
    );
    cursor = start + token.length;
  }

  if (parts.length === 0) return <HighlightedText text={text} patterns={patterns} />;
  if (cursor < text.length) {
    parts.push(<HighlightedText key={cursor} text={text.slice(cursor)} patterns={patterns} />);
  }
  return <>{parts}</>;
};
