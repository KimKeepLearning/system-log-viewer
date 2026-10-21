import { ipcMain } from "electron";
import * as path from "path";
import { extractLogBuffer } from "../archive";
import {
  collect,
  disconnect,
  execCommand,
  readRemoteFile,
  startFollow,
  stopFollow,
  SSHTarget
} from "./client";

export type { ExecResult, FollowStatus, SSHTarget } from "./client";

export const registerSSHHandlers = (): void => {
  // Pulled files go through the same extraction as dropped ones, so a remote
  // .tgz or rotated .gz opens like a local one.
  ipcMain.handle("ssh:read-file", async (_event, target: SSHTarget, filePath: string) =>
    extractLogBuffer(path.posix.basename(filePath), await readRemoteFile(target, filePath))
  );

  ipcMain.handle("ssh:exec", (_event, target: SSHTarget, command: string) =>
    execCommand(target, command)
  );

  ipcMain.handle(
    "ssh:collect",
    async (_event, target: SSHTarget, command: string, remotePath: string) =>
      extractLogBuffer(path.posix.basename(remotePath), await collect(target, command, remotePath))
  );

  ipcMain.handle("ssh:follow-start", (event, id: string, target: SSHTarget, command: string) => {
    const send = (channel: string, payload: unknown) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
    };

    startFollow(id, target, command, {
      onData: (chunk) => send("ssh:follow-data", { id, chunk }),
      onStatus: (status) => send("ssh:follow-status", status)
    });
    return id;
  });

  ipcMain.handle("ssh:follow-stop", (_event, id: string) => stopFollow(id));

  ipcMain.handle("ssh:disconnect", (_event, target: SSHTarget) => disconnect(target));
};
