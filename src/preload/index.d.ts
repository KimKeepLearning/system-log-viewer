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

  interface Window {
    electron: ElectronAPI;
    api: {
      getPathForFile: (file: File) => string;
      readLogFile: (filePath: string) => Promise<ExtractedLogFile[]>;
      readRemoteFile: (config: any, filePath: string) => Promise<string>;
    };
  }
}
