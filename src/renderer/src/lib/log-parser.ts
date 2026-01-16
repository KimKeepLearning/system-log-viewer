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
  line = line.trim();
  if (!line) {
    return { timestamp: "", level: "INFO", process: "", source: "", message: "" };
  }

  // Try different strategies
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
