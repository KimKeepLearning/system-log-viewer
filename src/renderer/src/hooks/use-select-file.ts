import { loadLogContentAtom } from "@renderer/lib/atom";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";

export const useSelectFile = () => {
  const loadLogContent = useSetAtom(loadLogContentAtom);
  const navigate = useNavigate();

  const handleFileSelect = async (file: File) => {
    let path = "";
    try {
      if (window.api && typeof window.api.getPathForFile === "function") {
        path = window.api.getPathForFile(file);
      } else {
        path = (file as File & { path: string }).path;
      }
    } catch (e) {
      console.warn("Failed to get path:", e);
      path = (file as File & { path: string }).path;
    }

    if (path) {
      try {
        const result = await window.electron.ipcRenderer.invoke("read-file", path);
        if (typeof result === "string") {
          loadLogContent(result);
          navigate({ to: "/dashboard/main" });
        }
      } catch (err) {
        console.error("Error reading file:", err);
      }
    }
  };

  const handleUploadClick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,.log,.zip";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    };
    input.click();
  };

  return { handleFileSelect, handleUploadClick };
};
