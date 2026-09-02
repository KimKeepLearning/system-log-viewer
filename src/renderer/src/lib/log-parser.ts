import { IUserLog } from "./typings";
import { Board, DeviceInfo } from "./typings/device";
import { monotonicSecondsToMicros, parseWallTimestamp } from "./log-time";

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

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG" | "";

const normalizeLevel = (rawLevel: string): LogLevel => {
  if (rawLevel === "ERROR" || rawLevel === "CRIT" || rawLevel === "ALERT" || rawLevel === "EMERG") {
    return "ERROR";
  }
  if (rawLevel === "WARN" || rawLevel === "WARNING") return "WARN";
  if (rawLevel.startsWith("VERBOSE") || rawLevel === "DEBUG") return "DEBUG";
  // EVENT and USER come from chrome's device_event_log, which has its own set.
  return "INFO";
};

// "../../foo/bar/src/ui/views/thing.cc:12" -> "ui/views/thing.cc:12"
const shortenSource = (source: string): string => source.replace(/(?:\.\.\/)+.*?\/src\//g, "");

const parseStandardLogLine = (line: string): IUserLog | null => {
  // Example: 2026-08-31T06:17:25.092359Z WARNING chrome[1016:1016]: [source] message
  const logMatch = line.match(/^(\S+)\s+(\w+)\s+(.*?):\s+(.*)$/);
  if (!logMatch) return null;

  // Without this check the pattern swallows any "word word ...: rest" line, so
  // `ifconfig` or `ps` output would be handed a fabricated timestamp and then
  // sorted into the merged timeline.
  const ts = parseWallTimestamp(logMatch[1]);
  if (ts === null) return null;

  let source = "";
  let message = logMatch[4];

  // Try to splice source from message if it matches [source] ...
  const sourceMatch = message.match(/^\[(.*?)\]\s+(.*)$/);
  if (sourceMatch) {
    source = shortenSource(sourceMatch[1]);
    message = sourceMatch[2];
  }

  // What remains may start with a subsystem label the code chose, as in
  // `[AI Subscription] ...`. Words and spaces only, and no slash: that keeps
  // paths, `[0831/061736]` sampler stamps and bare `[dbus/o` truncations out.
  let tag: string | undefined;
  const tagMatch = message.match(/^\[([A-Za-z][A-Za-z0-9 _.-]{1,30})\]\s+(.*)$/);
  if (tagMatch) {
    tag = tagMatch[1];
    message = tagMatch[2];
  }

  return {
    timestamp: logMatch[1],
    ts,
    tsKind: "wall",
    level: normalizeLevel(logMatch[2]),
    process: logMatch[3],
    source,
    tag,
    message
  };
};

// Example: <6>[    0.606417] pcieport 0000:00:1c.0: AER: Corrected error received
// The <N> prefix is a syslog priority; its low three bits are the severity,
// which is the only level information a kernel line carries.
const KERNEL_SEVERITY_LEVELS: LogLevel[] = [
  "ERROR", // emerg
  "ERROR", // alert
  "ERROR", // crit
  "ERROR", // err
  "WARN", // warning
  "INFO", // notice
  "INFO", // info
  "DEBUG" // debug
];

const parseKernelLogLine = (line: string): IUserLog | null => {
  const match = line.match(/^(?:<(\d{1,3})>)?\[\s*(\d+\.\d+)\]\s?(.*)$/);
  if (!match) return null;

  const [, priority, seconds, message] = match;

  return {
    timestamp: `[${seconds}]`,
    // Relative to boot; log-processor rewrites this to wall time once it can
    // pair the two clocks via the syslog section.
    ts: monotonicSecondsToMicros(seconds),
    tsKind: "monotonic",
    level: priority ? KERNEL_SEVERITY_LEVELS[Number(priority) & 7] : "",
    process: "kernel",
    source: "",
    message
  };
};

// Example, from device_event_log and network_event_log:
// 2026-08-30T23:17:31.303993-07:00 USB: ERROR chrome[1016]: usb_service_linux.cc:255 message
// The optional word before the level is chrome's own component tag (USB,
// Bluetooth, Login, ...), and the file:line is written bare rather than in
// brackets, so the generic parser folded it into the message.
const parseDeviceEventLogLine = (line: string): IUserLog | null => {
  const match = line.match(
    /^(\S+)\s+(?:([A-Za-z]+):\s+)?(ERROR|WARNING|EVENT|USER|DEBUG)\s+(\S+?):\s+(\S+\.\w+:\d+)\s+(.*)$/
  );
  if (!match) return null;

  const ts = parseWallTimestamp(match[1]);
  if (ts === null) return null;

  const [, , component, level, process, sourceFile, message] = match;

  return {
    timestamp: match[1],
    ts,
    tsKind: "wall",
    level: normalizeLevel(level),
    process,
    // Kept alongside the file so the component is not lost; IUserLog has no
    // field of its own for it and adding one costs a slot on every log line.
    source: component ? `${component}: ${sourceFile}` : sourceFile,
    message
  };
};

// Example, from the vibe-service sections:
// [2026-08-21 23:16:25.285] [INFO] [service::usbfs_client::handler:293] message
//
// The timestamp carries no zone. parseWallTimestamp reads it as UTC, which is
// deterministic but shifts these entries by the writer's offset if the service
// logged local time.
const parseBracketedTimestampLogLine = (line: string): IUserLog | null => {
  const match = line.match(
    /^\[(\d{4}-\d{2}-\d{2}[ T][\d:.]+)\]\s+\[(\w+)\]\s+(?:\[([^\]]+)\]\s+)?(.*)$/
  );
  if (!match) return null;

  const ts = parseWallTimestamp(match[1]);
  if (ts === null) return null;

  return {
    timestamp: match[1],
    ts,
    tsKind: "wall",
    level: normalizeLevel(match[2]),
    process: "",
    source: match[3] ? shortenSource(match[3]) : "",
    message: match[4]
  };
};

const parseBracketLevelLogLine = (line: string): IUserLog | null => {
  // Example: [WARN] some message
  const bracketMatch = line.match(/^\[(ERROR|WARN|WARNING|INFO|DEBUG|VERBOSE)\]\s+(.*)$/);
  if (!bracketMatch) return null;

  return {
    timestamp: "",
    ts: null,
    level: normalizeLevel(bracketMatch[1]),
    process: "",
    source: "",
    message: bracketMatch[2]
  };
};

// Example: WARNING audit_log_filter: [../../debugd/src/helpers/x.cc:57] Failed.
// Some sections (audit_log, update_engine.log) drop the timestamp but keep the
// level, which used to be misread as a timestamp by parseStandardLogLine.
const parseLevelPrefixedLogLine = (line: string): IUserLog | null => {
  const match = line.match(/^(ERROR|WARNING|WARN|NOTICE|INFO|DEBUG|VERBOSE\d*)\s+(\S+?):\s+(.*)$/);
  if (!match) return null;

  let source = "";
  let message = match[3];

  const sourceMatch = message.match(/^\[(.*?)\]\s+(.*)$/);
  if (sourceMatch) {
    source = shortenSource(sourceMatch[1]);
    message = sourceMatch[2];
  }

  return {
    timestamp: "",
    ts: null,
    level: normalizeLevel(match[1]),
    process: match[2],
    source,
    message
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
    ts: parseWallTimestamp(match[1]),
    tsKind: "wall",
    level: "",
    process: match[2],
    source: "",
    message: match[3]
  };
};

// Kernel lines are tried first: "<6>[  0.6] pcieport 0000:00:1c.0: AER: ..."
// also satisfies the looser standard pattern, which would misread the priority
// prefix as a timestamp.
// Order matters: the more specific patterns run before parseStandardLogLine,
// which is loose enough to half-match several of them and lose fields.
const STRATEGIES = [
  parseKernelLogLine,
  parseBracketedTimestampLogLine,
  parseDeviceEventLogLine,
  parseStandardLogLine,
  parseCrasAtlogLine,
  parseBracketLevelLogLine,
  parseLevelPrefixedLogLine
];

const unstructured = (message: string): IUserLog => ({
  timestamp: "",
  ts: null,
  level: "",
  process: "",
  source: "",
  message
});

export const parseLogLine = (line: string): IUserLog => {
  // Optimization: Don't trim huge lines repeatedly or regex them
  if (line.length > 2000) {
    return unstructured(line.trim());
  }

  line = line.trim();
  if (!line) return unstructured("");

  for (const strategy of STRATEGIES) {
    const result = strategy(line);
    if (result) return result;
  }

  return unstructured(line);
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

export interface LogField {
  key: string;
  value: string;
}

// Keys are short labels like CHROMEOS_RELEASE_BOARD or "CHROME VERSION"; this
// bound keeps a stray '=' deep inside a log line from being read as one.
const MAX_FIELD_KEY_LENGTH = 60;

/**
 * Pulls the single-line `key=value` fields that sit between the `<multiline>`
 * sections. A system_logs.txt carries around 170 of them — board, HWID, channel,
 * firmware, enrollment, free disk space — and until now only three reached the
 * UI.
 */
export const extractSingleLineFields = (content: string): LogField[] => {
  const fields: LogField[] = [];
  let insideSection = false;

  for (const line of content.split("\n")) {
    if (insideSection) {
      if (/^-+\s*END\s*-+\s*$/.test(line)) insideSection = false;
      continue;
    }

    if (line.includes("=<multiline>")) {
      insideSection = true;
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0 || separator > MAX_FIELD_KEY_LENGTH) continue;

    fields.push({
      key: line.slice(0, separator).trim(),
      value: line.slice(separator + 1).trim()
    });
  }

  return fields;
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
