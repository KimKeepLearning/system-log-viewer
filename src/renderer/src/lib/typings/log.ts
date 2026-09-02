import { TimestampKind } from "../log-time";

export interface LogFileContext {
  id: string; // unique identifier (path or name)
  name: string;
  content: string;
  /** A `data:` URL when this entry is an image (e.g. a feedback screenshot). */
  imageDataUrl?: string;
}

/** Counted once while parsing so the sidebar never has to walk the logs. */
export interface SectionStats {
  lines: number;
  errors: number;
  warnings: number;
  firstTs: number | null;
  lastTs: number | null;
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
  /**
   * A subsystem label the code put at the front of the message, as in
   * `[AI Subscription] user belongs to 4 workspaces`. Worth its own field
   * because it says which feature a line belongs to, which the file path only
   * hints at.
   */
  tag?: string;
  /** The capture cut this line off; only ever set on the last line of a section. */
  truncated?: boolean;
}
