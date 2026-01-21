import { ElectronAPI } from "@electron-toolkit/preload";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      getPathForFile: (file: File) => string;
      readRemoteFile: (config: any, filePath: string) => Promise<string>;
    };
  }
}
