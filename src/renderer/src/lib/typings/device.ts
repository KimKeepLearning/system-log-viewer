export enum Board {
  Orthrus = "orthrus",
  S1A = "vibe",
  S1B = "vibe-rk3588",
  unknown = "unknown"
}

export enum LogType {
  ChromeUserLog = "chrome_user_log",
  ChromePreviousUserLog = "chrome_previous_user_log",
  ChromeSystemLog = "chrome_system_log",
  ChromePreviousSystemLog = "chrome_previous_system_log"
}

export interface DeviceInfo {
  board: Board;
  version: string;
  arcStatus: string;
}
