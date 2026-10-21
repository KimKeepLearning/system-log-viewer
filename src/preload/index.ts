import { contextBridge, webUtils, ipcRenderer, IpcRendererEvent } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type { ExtractedLogFile } from "../main/archive";
import type { ExecResult, SSHTarget } from "../main/ssh";
import type { AiEvent, AiRunRequest, AiSettings } from "../main/ai";
import type { McpStatus } from "../main/mcp";

type McpHandler = (name: string, input: unknown) => string;
let mcpHandler: McpHandler | null = null;

// Installed once, so Claude Code gets an answer even before a log is open.
ipcRenderer.on(
  "mcp:tool-call",
  (_event: IpcRendererEvent, payload: { callId: string; name: string; input: unknown }) => {
    let result: string;
    try {
      result = mcpHandler
        ? mcpHandler(payload.name, payload.input)
        : "No log archive is open in System Log Viewer. Ask the engineer to open one.";
    } catch (error) {
      result = `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
    ipcRenderer.send("mcp:tool-result", { callId: payload.callId, result });
  }
);

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
  mcp: {
    status: (): Promise<McpStatus | null> => ipcRenderer.invoke("mcp:status"),
    /** Answers Claude Code's log tool calls until the returned function is called. */
    serve: (handler: McpHandler): (() => void) => {
      mcpHandler = handler;
      return () => {
        if (mcpHandler === handler) mcpHandler = null;
      };
    },
    onActivity: (
      listener: (activity: { name: string; input: unknown; at: number }) => void
    ): (() => void) => {
      const wrapped = (
        _event: IpcRendererEvent,
        payload: { name: string; input: unknown; at: number }
      ) => listener(payload);
      ipcRenderer.on("mcp:activity", wrapped);
      return () => ipcRenderer.off("mcp:activity", wrapped);
    }
  },
  ai: {
    getSettings: (): Promise<AiSettings> => ipcRenderer.invoke("ai:get-settings"),
    setKey: (key: string | null): Promise<AiSettings> => ipcRenderer.invoke("ai:set-key", key),
    pickSourceRoot: (): Promise<AiSettings> => ipcRenderer.invoke("ai:pick-source-root"),
    clearSourceRoot: (): Promise<AiSettings> => ipcRenderer.invoke("ai:clear-source-root"),
    start: (request: AiRunRequest): Promise<string> => ipcRenderer.invoke("ai:start", request),
    cancel: (runId: string): Promise<void> => ipcRenderer.invoke("ai:cancel", runId),
    /**
     * Subscribes to a run's events and answers its log tool calls. Returns the
     * unsubscribe function.
     */
    listen: (
      onEvent: (event: AiEvent) => void,
      onToolCall: (call: { runId: string; name: string; input: unknown }) => string
    ): (() => void) => {
      const eventListener = (_event: IpcRendererEvent, payload: AiEvent) => onEvent(payload);
      const callListener = (
        _event: IpcRendererEvent,
        payload: { runId: string; callId: string; name: string; input: unknown }
      ) => {
        let result: string;
        try {
          result = onToolCall(payload);
        } catch (error) {
          result = `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
        ipcRenderer.send("ai:tool-result", { callId: payload.callId, result });
      };
      ipcRenderer.on("ai:event", eventListener);
      ipcRenderer.on("ai:tool-call", callListener);
      return () => {
        ipcRenderer.off("ai:event", eventListener);
        ipcRenderer.off("ai:tool-call", callListener);
      };
    }
  },
  ssh: {
    readFile: (target: SSHTarget, filePath: string): Promise<ExtractedLogFile[]> =>
      ipcRenderer.invoke("ssh:read-file", target, filePath),
    exec: (target: SSHTarget, command: string): Promise<ExecResult> =>
      ipcRenderer.invoke("ssh:exec", target, command),
    collect: (
      target: SSHTarget,
      command: string,
      remotePath: string
    ): Promise<ExtractedLogFile[]> =>
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
