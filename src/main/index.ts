import { app, shell, BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import * as fs from "fs";
import AdmZip from "adm-zip";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
const { updateElectronApp } = require("update-electron-app");
import { registerSSHHandlers } from "./ssh";

registerSSHHandlers();

updateElectronApp();

// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require("electron-squirrel-startup")) {
  app.quit();
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1500,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    },
    title: "System Log Viewer"
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId("com.electron");

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // IPC test
  ipcMain.on("ping", () => console.log("pong"));

  ipcMain.handle("read-file", (_, filePath) => {
    console.log("[Main] Received read-file request for:", filePath);
    try {
      if (!fs.existsSync(filePath)) {
        console.error("[Main] File does not exist:", filePath);
        return "Error: File does not exist";
      }

      // Handle zip files
      if (filePath.toLowerCase().endsWith(".zip")) {
        console.log("[Main] Detected zip file, attempting to extract system_logs.txt");
        try {
          const zip = new AdmZip(filePath);
          const zipEntries = zip.getEntries();

          console.log("[Main] Zip entries count:", zipEntries.length);

          const isSystemLogFile = (entry: AdmZip.IZipEntry): boolean => {
            if (entry.isDirectory) return false;
            const normalizedName = entry.entryName.replace(/\\/g, "/");
            if (normalizedName.toLowerCase().includes("__macosx") || entry.name.startsWith("._")) {
              return false;
            }

            const fileName = entry.entryName.split("/").pop()?.toLowerCase().trim();
            return fileName === "system_logs.txt" || fileName === "system_logs";
          };

          // Try to find system_logs.txt directly
          let logEntry = zipEntries.find(isSystemLogFile);

          // If not found, try to find system_logs.zip and look inside
          if (!logEntry) {
            console.log("[Main] system_logs.txt not found, looking for nested system_logs.zip...");
            const nestedZipEntry = zipEntries.find((entry) => {
              const normalizedName = entry.entryName.replace(/\\/g, "/");
              const fileName = normalizedName.split("/").pop()?.toLowerCase().trim();
              return (
                fileName === "system_logs.zip" &&
                !entry.isDirectory &&
                !normalizedName.toLowerCase().includes("__macosx")
              );
            });

            if (nestedZipEntry) {
              console.log("[Main] Found nested system_logs.zip, extracting...");
              try {
                const nestedZip = new AdmZip(nestedZipEntry.getData());
                const nestedEntries = nestedZip.getEntries();
                logEntry = nestedEntries.find(isSystemLogFile);
                if (logEntry) {
                  console.log("[Main] Found system_logs.txt inside nested zip");
                }
              } catch (err) {
                console.error("[Main] Error reading nested zip:", err);
              }
            }
          }

          if (logEntry) {
            console.log("[Main] Found system_logs.txt in zip:", logEntry.entryName);
            const content = logEntry.getData().toString("utf8");
            console.log("[Main] Extracted content length:", content.length);
            return content;
          } else {
            console.warn("[Main] system_logs.txt not found in zip");
            return "Error: system_logs.txt not found in the uploaded zip file.";
          }
        } catch (zipError) {
          console.error("[Main] Error processing zip file:", zipError);
          return `Error processing zip file: ${zipError}`;
        }
      }

      const content = fs.readFileSync(filePath, "utf-8");
      console.log("[Main] File read successfully, length:", content.length);
      return content;
    } catch (e) {
      console.error("[Main] Error reading file:", e);
      return `Error reading file: ${e}`;
    }
  });

  createWindow();

  app.on("activate", function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
