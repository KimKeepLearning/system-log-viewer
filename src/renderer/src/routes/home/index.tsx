import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Providers } from "@renderer/components/providers";
import { FileDropZone } from "@renderer/components/file-drop-zone";
import { logContentAtom } from "@renderer/lib/atom";
import { useSetAtom } from "jotai";
import { useState } from "react";

export const Route = createFileRoute("/home/")({
  component: RouteComponent
});

function RouteComponent() {
  const setLogContent = useSetAtom(logContentAtom);
  const [error, setError] = useState<string>();
  const navigate = useNavigate();

  const handleFileSelect = async (file: File) => {
    let path = "";
    try {
      if (window.api && typeof window.api.getPathForFile === "function") {
        path = window.api.getPathForFile(file);
      } else {
        console.warn(
          "window.api.getPathForFile is not available. Please restart the application to apply preload changes."
        );
        path = (file as File & { path: string }).path;
      }
    } catch (e) {
      console.warn("Failed to get path via webUtils, falling back to file.path", e);
      path = (file as File & { path: string }).path;
    }

    console.log("[Renderer] File selected:", { name: file.name, path: path, size: file.size });

    if (!path) {
      setError(
        "Error: File path is missing. If you just updated the code, please RESTART the application terminal/process."
      );
      return;
    }

    if (path) {
      try {
        console.log("[Renderer] Invoking read-file IPC with path:", path);
        const result = await window.electron.ipcRenderer.invoke("read-file", path);
        console.log("[Renderer] IPC Result length:", result ? result.length : "null");

        if (typeof result === "string") {
          setLogContent(result);
          navigate({
            to: "/dashboard"
          });
        } else {
          setError("Error: Failed to read file (IPC returned null)");
        }
      } catch (err) {
        console.error("[Renderer] IPC Error:", err);
        setError("Error reading file: " + (err instanceof Error ? err.message : String(err)));
      }
    } else {
      console.warn(
        '[Renderer] File object is missing "path" property. Is webPreferences.sandbox disabled?'
      );
      setError("Error: Could not determine file path. (File.path is empty)");
    }
  };

  return (
    <Providers>
      <div className="w-screen h-screen flex flex-col items-center justify-center p-8 bg-background text-foreground">
        <div className="max-w-2xl w-full flex flex-col gap-6">
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-bold tracking-tight">System Log Viewer</h1>
            <p className="text-muted-foreground">Upload, view and analyze system logs</p>
          </div>

          <FileDropZone onFileSelect={handleFileSelect} accept=".txt,.log" />
          {error && <div className="text-red-600">{error}</div>}
        </div>
      </div>
    </Providers>
  );
}
