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

export const parseChromeUserLog = (content: string): string[] => {
  // Matches:
  // Profile[0] chrome_user_log=<multiline>
  // ---------- START ----------
  // ... content ...
  // ---------- END ----------
  const regex =
    /Profile\[0\]\s+chrome_user_log=<multiline>\s*-+\s*START\s*-+\s*([\s\S]*?)\s*-+\s*END\s*-+/;
  const match = content.match(regex);

  const logString = match && match[1] ? match[1].trim() : "";
  return logString.split("\n");
};
