import { IUserLog } from "@renderer/lib/typings";

export const LogLevelMap: Record<string, string> = {
  ERROR: "text-red-500",
  WARN: "text-yellow-500",
  DEBUG: "text-gray-500",
  INFO: "text-blue-500",
  VERBOSE: "text-gray-400"
};

export const getLevelColor = (level?: string) => {
  if (!level) return "text-gray-500";
  const normalized = level.toUpperCase().trim();
  return LogLevelMap[normalized] || "text-gray-500";
};

export interface LogGroup {
  main: IUserLog;
  count: number;
  children: IUserLog[];
}

// Rebuilds a single log line from its parsed fields. Parsing is lossy (the raw
// line is not kept), so this is a canonical form rather than a byte-exact copy
// of the source: levels are normalized (WARNING -> WARN) and whitespace between
// fields collapses to a single space.
export const formatLogLine = (log: IUserLog): string => {
  const parts: string[] = [];

  if (log.timestamp) parts.push(log.timestamp);
  if (log.level) parts.push(log.level);
  if (log.process) {
    // Only the level-carrying formats put a colon after the process; the
    // level-less ones (e.g. `cras atlog`) write the process as a bare prefix.
    parts.push(log.level ? `${log.process}:` : log.process);
  }
  if (log.source) parts.push(`[${log.source}]`);
  // The tag was lifted out of the message for display, so it has to go back or
  // the copied line is not the line that was on screen.
  if (log.tag) parts.push(`[${log.tag}]`);
  if (log.message) parts.push(log.message);

  return parts.join(" ");
};

// The subset of a rendered row that copying cares about.
export interface CopyableLog extends IUserLog {
  sourceFile: string;
  duplicates: IUserLog[];
}

// A folded row stands for `1 + duplicates.length` occurrences in the source log.
export const countLogLines = (logs: CopyableLog[]): number =>
  logs.reduce((total, log) => total + 1 + log.duplicates.length, 0);

export const buildLogText = (logs: CopyableLog[]): string => {
  // A section marker is only worth the noise when the range actually crosses a
  // boundary; within a single section it would repeat on every paste.
  const spansSections = new Set(logs.map((log) => log.sourceFile)).size > 1;

  const lines: string[] = [];
  let currentSection: string | null = null;

  for (const log of logs) {
    if (spansSections && log.sourceFile !== currentSection) {
      if (lines.length > 0) lines.push("");
      lines.push(`--- ${log.sourceFile} ---`);
      currentSection = log.sourceFile;
    }

    lines.push(formatLogLine(log));
    // Emit every occurrence a folded row represents, so the clipboard reflects
    // the log rather than the collapsed view.
    for (const duplicate of log.duplicates) {
      lines.push(formatLogLine(duplicate));
    }
  }

  return lines.join("\n");
};
