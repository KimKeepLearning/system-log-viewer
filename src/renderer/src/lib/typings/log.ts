export interface LogFileContext {
  id: string; // unique identifier (path or name)
  name: string;
  content: string;
}

export interface IUserLog {
  timestamp?: string;
  level?: "INFO" | "WARN" | "ERROR" | "DEBUG" | "";
  message: string;
  process?: string;
  source?: string;
}
