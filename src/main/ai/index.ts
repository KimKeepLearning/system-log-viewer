import { randomUUID } from "crypto";
import { BrowserWindow, dialog, ipcMain, IpcMainEvent, WebContents } from "electron";
import { AiEvent, AiRunRequest, runInvestigation } from "./agent";
import { getApiKey, getSettings, getSourceRoot, setApiKey, setSourceRoot } from "./settings";

export type { AiEvent, AiRunRequest } from "./agent";
export type { AiSettings } from "./settings";

const runs = new Map<string, AbortController>();
const pendingCalls = new Map<string, (result: string) => void>();

// The renderer owns the parsed logs, so a log tool call is a round trip:
// main asks, the renderer answers on ai:tool-result with the same callId.
const askRenderer =
  (sender: WebContents, runId: string, signal: AbortSignal) => (name: string, input: unknown) =>
    new Promise<string>((resolve, reject) => {
      if (sender.isDestroyed()) {
        reject(new Error("The window closed"));
        return;
      }
      const callId = randomUUID();
      const onAbort = () => {
        pendingCalls.delete(callId);
        reject(new Error("Cancelled"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      pendingCalls.set(callId, (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      });
      sender.send("ai:tool-call", { runId, callId, name, input });
    });

export const registerAiHandlers = (): void => {
  ipcMain.handle("ai:get-settings", () => getSettings());

  ipcMain.handle("ai:set-key", (_event, key: string | null) => {
    setApiKey(key);
    return getSettings();
  });

  ipcMain.handle("ai:pick-source-root", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Choose the source checkout the device was built from",
      properties: ["openDirectory" as const]
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (!result.canceled && result.filePaths[0]) setSourceRoot(result.filePaths[0]);
    return getSettings();
  });

  ipcMain.handle("ai:clear-source-root", () => {
    setSourceRoot(null);
    return getSettings();
  });

  ipcMain.handle("ai:start", (event, request: AiRunRequest) => {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("No API key set");

    const runId = randomUUID();
    const controller = new AbortController();
    runs.set(runId, controller);
    const sender = event.sender;

    void runInvestigation(runId, request, {
      apiKey,
      sourceRoot: getSourceRoot(),
      signal: controller.signal,
      emit: (payload: AiEvent) => {
        if (!sender.isDestroyed()) sender.send("ai:event", payload);
      },
      callRenderer: askRenderer(sender, runId, controller.signal)
    }).finally(() => runs.delete(runId));

    return runId;
  });

  ipcMain.handle("ai:cancel", (_event, runId: string) => {
    runs.get(runId)?.abort();
  });

  ipcMain.on(
    "ai:tool-result",
    (_event: IpcMainEvent, payload: { callId: string; result: string }) => {
      const resolve = pendingCalls.get(payload.callId);
      pendingCalls.delete(payload.callId);
      resolve?.(payload.result);
    }
  );
};
