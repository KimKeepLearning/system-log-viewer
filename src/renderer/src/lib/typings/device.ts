export enum Board {
  Orthrus = "orthrus",
  S1A = "vibe",
  S1B = "vibe-rk3588",
  unknown = "unknown"
}

export enum LogType {
  ChromeUserLog = "chrome_user_log"
}

export interface DeviceInfo {
  board: Board;
  version: string;
  arcStatus: string;
}
