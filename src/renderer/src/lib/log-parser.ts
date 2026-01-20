import { IUserLog } from "./typings";
import { Board, DeviceInfo } from "./typings/device";

export const parseDeviceInfo = (content: string): DeviceInfo => {
  const lines = content.split("\n");
  const getVal = (key: string) => {
    const line = lines.find((l) => l.startsWith(`${key}=`));
    return line ? line.split("=")[1].trim() : undefined;
  };

  const boardStr = getVal("CHROMEOS_RELEASE_BOARD");
  const version = getVal("CHROMEOS_RELEASE_VERSION");
  const arcStatus = getVal("CHROMEOS_ARC_STATUS");

  // Default to Orthrus if unknown or handle appropriately.
  // For this snippet we cast, but in production validatation is better.
  let board: Board = Board.unknown;
  if (boardStr) {
    if (Object.values(Board).includes(boardStr as Board)) {
      board = boardStr as Board;
    }
  }

  return {
    board,
    version: version || "unknown",
    arcStatus: arcStatus || "unknown"
  };
};

export const extractLogSection = (content: string, key: string): string => {
  // Matches:
  // (Profile[0] )? key=<multiline>
  // ---------- START ----------
  // ... content ...
  // ---------- END ----------
  const escapedKey = key.replace(/\./g, "\\.");
  const regex = new RegExp(
    `(?:Profile\\[0\\]\\s+)?${escapedKey}=<multiline>[\\s\\S]*?-+\\s*START\\s*-+\\s*([\\s\\S]*?)\\s*-+\\s*END\\s*-+`
  );
  const match = content.match(regex);
  return match && match[1] ? match[1].trim() : "";
};

const parseStandardLogLine = (line: string): IUserLog | null => {
  // Example: 2026-01-13T17:10:20.704235Z ERROR chrome[1073:1073]: [source] message
  const logRegex = /^(\S+)\s+(\w+)\s+(.*?):\s+(.*)$/;
  const logMatch = line.match(logRegex);

  if (!logMatch) return null;

  let level = "INFO";
  const rawLevel = logMatch[2];

  if (rawLevel === "ERROR") level = "ERROR";
  else if (rawLevel === "WARNING") level = "WARN";
  else if (rawLevel.startsWith("VERBOSE")) level = "DEBUG";

  let source = "";
  let message = logMatch[4];

  // Try to splice source from message if it matches [source] ...
  const sourceMatch = message.match(/^\[(.*?)\]\s+(.*)$/);
  if (sourceMatch) {
    source = sourceMatch[1].replace(/(?:\.\.\/)+.*?\/src\//g, "");
    message = sourceMatch[2];
  }

  return {
    timestamp: logMatch[1],
    level: level as "INFO" | "WARN" | "ERROR" | "DEBUG",
    process: logMatch[3],
    source,
    message
  };
};

const parseBracketLevelLogLine = (line: string): IUserLog | null => {
  // Example: [WARN] some message
  const bracketMatch = line.match(/^\[(ERROR|WARN|WARNING|INFO|DEBUG|VERBOSE)\]\s+(.*)$/);
  if (!bracketMatch) return null;

  let level = "INFO";
  const rawLevel = bracketMatch[1];
  if (rawLevel === "ERROR") level = "ERROR";
  else if (rawLevel === "WARN" || rawLevel === "WARNING") level = "WARN";
  else if (rawLevel.startsWith("VERBOSE")) level = "DEBUG";

  return {
    timestamp: "",
    level: level as "INFO" | "WARN" | "ERROR" | "DEBUG",
    process: "",
    source: "",
    message: bracketMatch[2]
  };
};

const parseCrasAtlogLine = (line: string): IUserLog | null => {
  // Example: 2026-01-15T17:11:47.912820765 cras atlog  READ_AUDIO_TSTAMP ...
  // Regex matches: Timestamp, "cras atlog", Message
  const regex = /^(\S+)\s+(cras\s+atlog)\s+(.*)$/;
  const match = line.match(regex);

  if (!match) return null;

  return {
    timestamp: match[1],
    level: "",
    process: match[2],
    source: "",
    message: match[3]
  };
};

export const parseLogLine = (line: string): IUserLog => {
  // Optimization: Don't trim huge lines repeatedly or regex them
  if (line.length > 2000) {
    return {
      timestamp: "",
      level: "",
      process: "",
      source: "",
      message: line.trim()
    };
  }

  line = line.trim();
  if (!line) {
    return { timestamp: "", level: "INFO", process: "", source: "", message: "" };
  }

  // Optimization: Quick check before regex
  // Standard log usually has a timestamp like 202*-*-* or T...Z
  // And usually has : in it.

  // Try strategies
  const strategies = [parseStandardLogLine, parseCrasAtlogLine, parseBracketLevelLogLine];

  for (const strategy of strategies) {
    const result = strategy(line);
    if (result) return result;
  }

  // Fallback
  return {
    timestamp: "",
    level: "",
    process: "",
    source: "",
    message: line
  };
};

export const parseLogSection = (content: string, key: string): IUserLog[] => {
  const logString = extractLogSection(content, key);
  const lines = logString.split("\n");

  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseLogLine);
};

export const parseAllLogSections = (content: string): Record<string, IUserLog[]> => {
  const result: Record<string, IUserLog[]> = {};

  // Regex to match "key=<multiline> ... START ... content ... END"
  // Captures group 1: key
  // Captures group 2: content
  // Note: We use [^=\n]+ to capture keys that might contain spaces
  const sectionRegex =
    /(?:Profile\[0\]\s+)?([^=\n]+)=<multiline>[\s\S]*?-+\s*START\s*-+\s*([\s\S]*?)\s*-+\s*END\s*-+/g;

  let match;
  while ((match = sectionRegex.exec(content)) !== null) {
    const key = match[1].trim();
    const rawContent = match[2];

    const lines = rawContent.split("\n");
    const parsedLogs = lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map(parseLogLine);

    result[key] = parsedLogs;
  }

  return result;
};

export const extractSectionsRaw = (content: string): { key: string; rawContent: string }[] => {
  const result: { key: string; rawContent: string }[] = [];
  const sectionRegex =
    /(?:Profile\[0\]\s+)?([^=\n]+)=<multiline>[\s\S]*?-+\s*START\s*-+\s*([\s\S]*?)\s*-+\s*END\s*-+/g;

  let match;
  while ((match = sectionRegex.exec(content)) !== null) {
    result.push({
      key: match[1].trim(),
      rawContent: match[2]
    });
  }

  return result;
};

export const extractSectionsRawAsync = async (
  content: string,
  yielder?: () => Promise<void>
): Promise<{ key: string; rawContent: string }[]> => {
  const result: { key: string; rawContent: string }[] = [];
  let cursor = 0;
  const len = content.length;

  while (cursor < len) {
    // 1. Find "=<multiline>"
    const multiLineIndex = content.indexOf("=<multiline>", cursor);
    if (multiLineIndex === -1) break;

    // 2. Find Key
    // Look backwards from multiLineIndex to find the start of the key
    // The key usually starts after a newline or at the beginning of the file
    // The regex was: (?:Profile\[0\]\s+)?([^=\n]+)=<multiline>
    let keyStart = content.lastIndexOf("\n", multiLineIndex);
    keyStart = keyStart === -1 ? 0 : keyStart + 1;

    // Extract the raw key line segment
    let rawKeySegment = content.substring(keyStart, multiLineIndex).trim();

    // Clean up Profile[0] prefix if present (based on original regex)
    if (rawKeySegment.startsWith("Profile[0]")) {
      rawKeySegment = rawKeySegment.replace(/^Profile\[0\]\s+/, "");
    }

    // 3. Find START marker
    // Regex was: -+\s*START\s*-+
    // We'll search for "START" closely following
    const startSearchLimit = multiLineIndex + 200; // Heuristic: header shouldn't be miles away
    const startMarkerIndex = content.indexOf("START", multiLineIndex);

    if (startMarkerIndex === -1 || startMarkerIndex > startSearchLimit) {
      // Not a valid section start, skip this match
      cursor = multiLineIndex + 11; // Skip past "=<multiline>"
      continue;
    }

    // Find the end of the START line (the dashes)
    // The previous regex expected -+ after START
    const contentStartIndex = content.indexOf("\n", startMarkerIndex);
    if (contentStartIndex === -1) {
      cursor = len; // unexpected EOF
      break;
    }

    // 4. Find END marker
    // Regex was: -+\s*END\s*-+
    // We search for "---------- END" or just "END" surrounded by dashes
    // But since content can be huge, we need to be careful.
    // However, indexOf is native and fast.
    // We assume the standard Android/ChromeOS dumpstate format: usually "---------- END ----------"
    // Let's look for "---------- END"
    const endMarkerIndex = content.indexOf("---------- END", contentStartIndex);

    if (endMarkerIndex === -1) {
      // No end marker found? Take everything to end?
      // Or maybe this is a broken section.
      // Let's assume remainder is content (safer than infinite loop)
      const rawContent = content.substring(contentStartIndex + 1);
      result.push({ key: rawKeySegment, rawContent });
      break;
    }

    // Valid section found
    const rawContent = content.substring(contentStartIndex + 1, endMarkerIndex);
    result.push({ key: rawKeySegment, rawContent });

    // Move cursor
    cursor = content.indexOf("\n", endMarkerIndex);
    if (cursor === -1) cursor = len;

    // Yield if requested
    if (yielder) await yielder();
  }

  return result;
};
