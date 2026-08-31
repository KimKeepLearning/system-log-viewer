import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Providers } from "@renderer/components/providers";
import { FileDropZone } from "@renderer/components/file-drop-zone";
import { setProcessedLogsAtom } from "@renderer/lib/atom";
import { readFiles, readFilesByPath } from "@renderer/lib/file-loader";
import { forgetFile, recentFiles, type RecentFile } from "@renderer/lib/recent-files";
import { processFilesAsync } from "@renderer/lib/log-processor";
import { SSHConnectDialog } from "@renderer/components/ssh-connect-dialog";
import { LogFileContext } from "@renderer/lib/typings";
import { useSetAtom } from "jotai";
import { useState } from "react";
import { X } from "lucide-react";

export const Route = createFileRoute("/home/")({
  component: RouteComponent
});

function RouteComponent() {
  const setProcessedLogs = useSetAtom(setProcessedLogsAtom);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [recent, setRecent] = useState<RecentFile[]>(() => recentFiles());
  const navigate = useNavigate();

  const processLogContexts = async (processedFiles: LogFileContext[]) => {
    if (processedFiles && processedFiles.length > 0) {
      setStatus("Parsing logs...");

      // Use async processor to avoid freezing UI
      const { parsedLogs, structure, updatedFiles, sectionStats } = await processFilesAsync(
        processedFiles,
        (msg) => {
          setStatus(msg);
        }
      );

      setProcessedLogs({
        files: updatedFiles,
        parsedLogs,
        structure,
        sectionStats
      });

      setStatus("Navigating to dashboard...");
      navigate({
        to: "/dashboard/main"
      });
    } else {
      setError("Error: No valid content found.");
    }
  };

  const handleSSHConnect = async (files: LogFileContext[]) => {
    setLoading(true);
    setError(undefined);
    setStatus("Processing SSH logs...");
    try {
      await processLogContexts(files);
    } catch (err) {
      console.error("[Renderer] SSH Process Error:", err);
      setError("Error processing SSH logs: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
      setStatus("");
    }
  };

  const handleReopen = async (path: string) => {
    setLoading(true);
    setError(undefined);
    setStatus("Reading files...");
    try {
      await processLogContexts(await readFilesByPath([path]));
    } catch (err) {
      // The archive may have been moved or deleted since it was last opened.
      forgetFile(path);
      setRecent(recentFiles());
      setError(`Could not reopen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
      setStatus("");
    }
  };

  const handleFileSelect = async (files: File[]) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    setError(undefined);
    setStatus("Reading files...");

    try {
      console.log("[Home] Reading files:", files);
      const processedFiles = await readFiles(files);
      console.log("[Home] Processed files:", processedFiles);

      await processLogContexts(processedFiles);
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

          <div className="flex items-center justify-center gap-2">
            <span className="text-sm text-muted-foreground">or</span>
          </div>

          <div className="flex justify-center">
            <SSHConnectDialog onConnect={handleSSHConnect} onError={(msg) => setError(msg)} />
          </div>

          {recent.length > 0 && !loading && (
            <div className="flex flex-col gap-1">
              <div className="text-xs font-medium text-muted-foreground">Recent</div>
              {recent.map((entry) => (
                <div
                  key={entry.path}
                  className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-muted transition-colors"
                >
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left text-sm truncate"
                    title={entry.path}
                    onClick={() => handleReopen(entry.path)}
                  >
                    {entry.name}
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Forget this file"
                    onClick={() => {
                      forgetFile(entry.path);
                      setRecent(recentFiles());
                    }}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

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
