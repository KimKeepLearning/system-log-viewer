import { contextBridge, webUtils, ipcRenderer, IpcRendererEvent } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type { ExtractedLogFile } from "../main/archive";
import type { ExecResult, SSHTarget } from "../main/ssh";

interface FollowStatus {
  id: string;
  state: "connecting" | "reconnecting" | "streaming" | "waiting" | "error" | "gave-up" | "stopped";
  attempt: number;
  delay?: number;
  message?: string;
}

// Custom APIs for renderer
const api = {
  getPathForFile: (file: File): string => {
    return webUtils.getPathForFile(file);
  },
  readLogFile: (filePath: string): Promise<ExtractedLogFile[]> => {
    return ipcRenderer.invoke("read-file", filePath);
  },
  ssh: {
    readFile: (target: SSHTarget, filePath: string): Promise<string> =>
      ipcRenderer.invoke("ssh:read-file", target, filePath),
    exec: (target: SSHTarget, command: string): Promise<ExecResult> =>
      ipcRenderer.invoke("ssh:exec", target, command),
    collect: (target: SSHTarget, command: string, remotePath: string): Promise<string> =>
      ipcRenderer.invoke("ssh:collect", target, command, remotePath),
    disconnect: (target: SSHTarget): Promise<void> => ipcRenderer.invoke("ssh:disconnect", target),
    /** Streams a `-f` style command until the returned function is called. */
    follow: (
      id: string,
      target: SSHTarget,
      command: string,
      onData: (chunk: string) => void,
      onStatus: (status: FollowStatus) => void
    ): (() => void) => {
      const dataListener = (_event: IpcRendererEvent, payload: { id: string; chunk: string }) => {
        if (payload.id === id) onData(payload.chunk);
      };
      const statusListener = (_event: IpcRendererEvent, payload: FollowStatus) => {
        if (payload.id === id) onStatus(payload);
      };

      ipcRenderer.on("ssh:follow-data", dataListener);
      ipcRenderer.on("ssh:follow-status", statusListener);
      void ipcRenderer.invoke("ssh:follow-start", id, target, command);

      return () => {
        void ipcRenderer.invoke("ssh:follow-stop", id);
        ipcRenderer.off("ssh:follow-data", dataListener);
        ipcRenderer.off("ssh:follow-status", statusListener);
      };
    }
  }
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}
