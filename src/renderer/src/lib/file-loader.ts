import { LogFileContext } from "./typings/log";

export async function readFiles(files: File[]): Promise<LogFileContext[]> {
  const processedFiles: LogFileContext[] = [];

  for (const file of files) {
    let path = "";
    try {
      if (window.api && typeof window.api.getPathForFile === "function") {
        path = window.api.getPathForFile(file);
      } else {
        // Fallback for development/legacy
        path = (file as File & { path: string }).path;
      }
    } catch (e) {
      console.warn(`Failed to get path for ${file.name}`, e);
      // Try direct access if allowed
      path = (file as File & { path: string }).path;
    }

    if (!path) {
      console.error(`Could not determine path for file ${file.name}`);
      continue;
    }

    try {
      console.log(`[FileLoader] Reading ${path}`);
      const content = await window.electron.ipcRenderer.invoke("read-file", path);

      let finalContent = "";
      if (typeof content === "string") {
        finalContent = content;
      }

      // Use path as unique ID, but ensure name is unique if processing multiple files with same name?
      // For now, ID is path which is unique. Name can start to collide in UI if multiple files have same name.
      processedFiles.push({
        id: path,
        name: file.name,
        content: finalContent
      });
    } catch (err) {
      console.error(`Error reading file ${path}:`, err);
    }
  }

  return processedFiles;
}
