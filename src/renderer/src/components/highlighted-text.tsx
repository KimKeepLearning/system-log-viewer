import { ReactNode } from "react";

export const HighlightedText = ({
  text,
  query,
  isRegex
}: {
  text: string;
  query: string;
  isRegex: boolean;
}) => {
  if (!query || !text) return <span>{text}</span>;

  try {
    const effectiveQuery = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(effectiveQuery, "gi");

    const elements: ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIndex) {
        elements.push(
          <span key={`text-${lastIndex}`}>{text.substring(lastIndex, match.index)}</span>
        );
      }
      elements.push(
        <span key={`match-${match.index}`} className="bg-yellow-500/50 text-black">
          {match[0]}
        </span>
      );
      lastIndex = re.lastIndex;
      if (re.lastIndex === match.index) {
        re.lastIndex++; // Avoid infinite loop for zero-width assertions
      }
    }

    if (lastIndex < text.length) {
      elements.push(<span key={`text-${lastIndex}`}>{text.substring(lastIndex)}</span>);
    }

    if (elements.length === 0) return <span>{text}</span>;

    return <span>{elements}</span>;
  } catch {
    return <span>{text}</span>;
  }
};
