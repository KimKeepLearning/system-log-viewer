import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Providers } from "@renderer/components/providers";
import { FileDropZone } from "@renderer/components/file-drop-zone";
import { setProcessedLogsAtom } from "@renderer/lib/atom";
import { readFiles } from "@renderer/lib/file-loader";
import { processFilesAsync } from "@renderer/lib/log-processor";
import { useSetAtom } from "jotai";
import { useState } from "react";

export const Route = createFileRoute("/home/")({
  component: RouteComponent
});

function RouteComponent() {
  const setProcessedLogs = useSetAtom(setProcessedLogsAtom);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const navigate = useNavigate();

  const handleFileSelect = async (files: File[]) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    setError(undefined);
    setStatus("Reading files...");

    try {
      console.log("[Home] Reading files:", files);
      const processedFiles = await readFiles(files);
      console.log("[Home] Processed files:", processedFiles);

      if (processedFiles && processedFiles.length > 0) {
        setStatus("Parsing logs...");

        // Use async processor to avoid freezing UI
        const { parsedLogs, structure } = await processFilesAsync(processedFiles, (msg) => {
          setStatus(msg);
        });

        setProcessedLogs({
          files: processedFiles,
          parsedLogs,
          structure
        });

        setStatus("Navigating to dashboard...");
        navigate({
          to: "/dashboard/main"
        });
      } else {
        setError("Error: Failed to read files or files were empty.");
      }
    } catch (err) {
      console.error("[Renderer] File Load Error:", err);
      setError("Error reading files: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
      setStatus("");
    }
  };

  return (
    <Providers>
      <div className="w-screen h-screen flex flex-col items-center justify-center p-8 bg-background text-foreground">
        <div className="max-w-2xl w-full flex flex-col gap-6">
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-bold tracking-tight">System Log Viewer</h1>
            <p className="text-muted-foreground">Upload and view system logs</p>
          </div>

          <FileDropZone onFileSelect={handleFileSelect} accept=".txt,.log,.zip" multiple={true} />

          {loading && (
            <div className="text-center text-muted-foreground animate-pulse">
              {status || "Processing..."}
            </div>
          )}

          {error && (
            <div className="text-red-600 text-center font-medium bg-red-50 p-2 rounded">
              {error}
            </div>
          )}
        </div>
      </div>
    </Providers>
  );
}
