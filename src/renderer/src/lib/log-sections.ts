/**
 * Raw section text by key, for the parsers that read a section as a table or a
 * document rather than as log lines. Built with indexOf like
 * extractSectionsRawAsync; a regex per lookup would rescan a 100 MB file each
 * time.
 */
export type SectionMap = Map<string, string>;

const MULTILINE = "=<multiline>";
const END_MARKER = "---------- END";

export const buildSectionMap = (content: string): SectionMap => {
  const sections: SectionMap = new Map();
  let cursor = 0;

  while (cursor < content.length) {
    const marker = content.indexOf(MULTILINE, cursor);
    if (marker === -1) break;

    const lineStart = content.lastIndexOf("\n", marker) + 1;
    const key = content
      .substring(lineStart, marker)
      .trim()
      .replace(/^Profile\[0\]\s+/, "");

    const startLine = content.indexOf("\n", marker);
    const startMarker = content.indexOf("START", marker);
    if (startLine === -1 || startMarker === -1 || startMarker > marker + 200) {
      cursor = marker + MULTILINE.length;
      continue;
    }

    const bodyStart = content.indexOf("\n", startMarker) + 1;
    const end = content.indexOf(END_MARKER, bodyStart);
    const body = content.substring(bodyStart, end === -1 ? content.length : end);
    if (!sections.has(key)) sections.set(key, body);

    if (end === -1) break;
    cursor = end + END_MARKER.length;
  }

  return sections;
};

const PLACEHOLDERS = /^<(?:no matches|not available|empty|multiline)>$|^<not available/i;

/** A section's text, or "" when it is missing or one of debugd's placeholders. */
export const sectionText = (sections: SectionMap, key: string): string => {
  const body = sections.get(key);
  if (!body) return "";
  const trimmed = body.trim();
  return PLACEHOLDERS.test(trimmed) ? "" : body;
};

export const findSectionKeys = (sections: SectionMap, pattern: RegExp): string[] =>
  [...sections.keys()].filter((key) => pattern.test(key));
