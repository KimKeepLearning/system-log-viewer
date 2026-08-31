import { TimestampKind } from "../log-time";

export interface LogFileContext {
  id: string; // unique identifier (path or name)
  name: string;
  content: string;
  /** A `data:` URL when this entry is an image (e.g. a feedback screenshot). */
  imageDataUrl?: string;
}

export interface IUserLog {
  /** The timestamp exactly as it appeared, for display. */
  timestamp?: string;
  /**
   * Epoch microseconds, or microseconds since boot while `tsKind` is
   * "monotonic". Null when the line carried no parseable time, which is what
   * keeps such lines out of the merged timeline.
   */
  ts?: number | null;
  tsKind?: TimestampKind;
  level?: "INFO" | "WARN" | "ERROR" | "DEBUG" | "";
  message: string;
  process?: string;
  source?: string;
}
