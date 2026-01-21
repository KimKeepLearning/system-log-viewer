import { ipcMain } from "electron";
import { Client, ConnectConfig } from "ssh2";
import * as fs from "fs";

export const registerSSHHandlers = () => {
  ipcMain.handle(
    "ssh:read-file",
    async (_, config: ConnectConfig & { privateKeyPath?: string }, filePath: string) => {
      return new Promise((resolve, reject) => {
        const conn = new Client();

        conn.on("ready", () => {
          conn.sftp((err, sftp) => {
            if (err) {
              conn.end();
              return reject(err);
            }

            const stream = sftp.createReadStream(filePath);
            let data = "";

            stream.on("data", (chunk) => {
              data += chunk.toString();
            });

            stream.on("end", () => {
              conn.end();
              resolve(data);
            });

            stream.on("error", (err) => {
              conn.end();
              reject(err);
            });
          });
        });

        conn.on("error", (err) => {
          console.error("SSH Client Error:", err);
          reject(err);
        });

        conn.on(
          "keyboard-interactive",
          (_name, _instructions, _instructionsLang, prompts, finish) => {
            finish(prompts.map(() => config.password || ""));
          }
        );

        try {
          const connectConfig: ConnectConfig = { ...config, tryKeyboard: true };
          if (config.privateKeyPath) {
            connectConfig.privateKey = fs.readFileSync(config.privateKeyPath);
          }
          conn.connect(connectConfig);
        } catch (e) {
          console.error("SSH Connect Error:", e);
          reject(e);
        }
      });
    }
  );
};
