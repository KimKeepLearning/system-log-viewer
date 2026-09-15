import { ipcMain } from "electron";
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
  ipcMain.handle("ssh:read-file", (_event, target: SSHTarget, filePath: string) =>
    readRemoteFile(target, filePath)
  );

  ipcMain.handle("ssh:exec", (_event, target: SSHTarget, command: string) =>
    execCommand(target, command)
  );

  ipcMain.handle("ssh:collect", (_event, target: SSHTarget, command: string, remotePath: string) =>
    collect(target, command, remotePath)
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
