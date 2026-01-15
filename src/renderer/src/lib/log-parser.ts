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

export const parseLogSection = (content: string, key: string): IUserLog[] => {
  // Matches:
  // (Profile[0] )? key=<multiline>
  // ---------- START ----------
  // ... content ...
  // ---------- END ----------
  // We escape dots in key just in case, though usually simpler is fine.
  const escapedKey = key.replace(/\./g, "\\.");
  const regex = new RegExp(
    `(?:Profile\\[0\\]\\s+)?${escapedKey}=<multiline>[\\s\\S]*?-+\\s*START\\s*-+\\s*([\\s\\S]*?)\\s*-+\\s*END\\s*-+`
  );
  const match = content.match(regex);
  const logString = match && match[1] ? match[1].trim() : "";
  const lines = logString.split("\n");

  // Parse each line into IUserLog entries
  const logs: IUserLog[] = lines
    .map((line) => {
      line = line.trim();
      if (!line) return null;

      // Example log line format:
      // 2026-01-13T17:10:20.704235Z ERROR chrome[1073:1073]: [source] message
      // Use non-greedy match for process part to stop at the first ": " separator
      const logRegex = /^(\S+)\s+(\w+)\s+(.*?):\s+(.*)$/;
      const logMatch = line.match(logRegex);

      if (logMatch) {
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
      } else {
        // If line doesn't match expected format, return as INFO with raw message
        return {
          timestamp: "",
          level: "INFO",
          process: "",
          source: "",
          message: line
        };
      }
    })
    .filter((log): log is IUserLog => log !== null);

  return logs;
};
