import { atom } from "jotai";
import { formatLogLine } from "./log-utils";
import { sectionNameOf } from "./log-domains";
import { IUserLog } from "./typings";

/**
 * A bookmark keeps a copy of the line rather than a pointer to it. Row indices
 * shift the moment a filter changes, and the parsed logs are rebuilt whenever a
 * new archive is opened, so anything that had to be re-resolved would go stale.
 */
export interface Bookmark {
  id: string;
  sourceFile: string;
  ts: number | null;
  timestamp: string;
  level: NonNullable<IUserLog["level"]>;
  process: string;
  source: string;
  message: string;
  note: string;
}

export const bookmarkKey = (log: { sourceFile: string; ts?: number | null; message: string }) =>
  `${log.sourceFile}|${log.ts ?? ""}|${log.message}`;

export const bookmarksAtom = atom<Bookmark[]>([]);

export const bookmarkKeysAtom = atom((get) => new Set(get(bookmarksAtom).map((mark) => mark.id)));

export const toggleBookmarkAtom = atom(null, (get, set, log: IUserLog & { sourceFile: string }) => {
  const id = bookmarkKey(log);
  const existing = get(bookmarksAtom);
  if (existing.some((mark) => mark.id === id)) {
    set(
      bookmarksAtom,
      existing.filter((mark) => mark.id !== id)
    );
    return;
  }

  const mark: Bookmark = {
    id,
    sourceFile: log.sourceFile,
    ts: log.ts ?? null,
    timestamp: log.timestamp ?? "",
    level: log.level ?? "",
    process: log.process ?? "",
    source: log.source ?? "",
    message: log.message,
    note: ""
  };

  // Kept in time order so the export reads as a sequence of events rather
  // than the order they happened to be clicked in.
  set(
    bookmarksAtom,
    [...existing, mark].sort((a, b) => (a.ts ?? Infinity) - (b.ts ?? Infinity))
  );
});

export const setBookmarkNoteAtom = atom(null, (get, set, id: string, note: string) => {
  set(
    bookmarksAtom,
    get(bookmarksAtom).map((mark) => (mark.id === id ? { ...mark, note } : mark))
  );
});

const clock = (mark: Bookmark): string =>
  mark.ts === null ? mark.timestamp : new Date(mark.ts / 1000).toISOString().replace("T", " ");

/**
 * A timeline that can be pasted straight into a bug: the evidence in order,
 * each line with whatever the reader concluded about it.
 */
export const bookmarksToMarkdown = (marks: Bookmark[], deviceLine?: string): string => {
  if (marks.length === 0) return "";

  const lines = ["# Log timeline", ""];
  if (deviceLine) lines.push(`_${deviceLine}_`, "");

  for (const mark of marks) {
    lines.push(`### ${clock(mark)} — ${sectionNameOf(mark.sourceFile)}`);
    lines.push("");
    lines.push("```");
    lines.push(formatLogLine(mark));
    lines.push("```");
    if (mark.note.trim()) {
      lines.push("");
      lines.push(mark.note.trim());
    }
    lines.push("");
  }

  return lines.join("\n");
};
