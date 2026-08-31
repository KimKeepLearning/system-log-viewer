import { setProcessedLogsAtom } from "@renderer/lib/atom";
import { readFiles } from "@renderer/lib/file-loader";
import { processFilesAsync } from "@renderer/lib/log-processor";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useState } from "react";

export const useSelectFile = () => {
  const setProcessedLogs = useSetAtom(setProcessedLogsAtom);
  const navigate = useNavigate();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressStatus, setProgressStatus] = useState("");

  const handleFileSelect = async (files: File[]) => {
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    setProgressStatus("Reading files...");

    try {
      const processedFiles = await readFiles(files);
      if (processedFiles && processedFiles.length > 0) {
        const { parsedLogs, structure, updatedFiles, sectionStats } = await processFilesAsync(
          processedFiles,
          (msg) => {
            setProgressStatus(msg);
          }
        );

        setProcessedLogs({
          files: updatedFiles,
          parsedLogs,
          structure,
          sectionStats
        });

        navigate({ to: "/dashboard/main" });
      }
    } catch (err) {
      console.error("Error reading file:", err);
    } finally {
      setIsProcessing(false);
      setProgressStatus("");
    }
  };

  const handleUploadClick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,.log,.zip";
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        handleFileSelect(Array.from(files));
      }
    };
    input.click();
  };

  return { handleFileSelect, handleUploadClick, isProcessing, progressStatus };
};
