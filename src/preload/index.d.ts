import { ElectronAPI } from "@electron-toolkit/preload";

declare global {
  // One log file as it crosses the IPC boundary. A single dropped archive can
  // produce many of these, so `name` is the display path inside it, e.g.
  // "feedback.zip/system_logs.txt".
  //
  // Declared here rather than imported because src/main is not part of the
  // renderer's tsconfig; it mirrors ExtractedLogFile in src/main/archive.ts.
  interface ExtractedLogFile {
    name: string;
    /** Text content. Empty when the entry is an image. */
    content: string;
    /** A `data:` URL, set only for image entries such as the feedback screenshot. */
    imageDataUrl?: string;
  }

  /** Mirrors SSHTarget in src/main/ssh/index.ts, for the same reason. */
  interface SSHTarget {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
  }

  interface SSHExecResult {
    code: number | null;
    stdout: string;
    stderr: string;
  }

  type SSHFollowState =
    | "connecting"
    | "reconnecting"
    | "streaming"
    | "waiting"
    | "error"
    | "gave-up"
    | "stopped";

  interface SSHFollowStatus {
    id: string;
    state: SSHFollowState;
    attempt: number;
    /** Milliseconds until the next attempt, while waiting. */
    delay?: number;
    message?: string;
  }

  interface Window {
    electron: ElectronAPI;
    api: {
      getPathForFile: (file: File) => string;
      readLogFile: (filePath: string) => Promise<ExtractedLogFile[]>;
      ssh: {
        readFile: (target: SSHTarget, filePath: string) => Promise<string>;
        exec: (target: SSHTarget, command: string) => Promise<SSHExecResult>;
        collect: (target: SSHTarget, command: string, remotePath: string) => Promise<string>;
        disconnect: (target: SSHTarget) => Promise<void>;
        follow: (
          id: string,
          target: SSHTarget,
          command: string,
          onData: (chunk: string) => void,
          onStatus: (status: SSHFollowStatus) => void
        ) => () => void;
      };
    };
  }
}
