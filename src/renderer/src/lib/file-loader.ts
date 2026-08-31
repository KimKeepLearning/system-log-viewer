import { LogFileContext } from "./typings/log";
import { rememberFiles } from "./recent-files";

const getPath = (file: File): string => {
  try {
    if (window.api && typeof window.api.getPathForFile === "function") {
      return window.api.getPathForFile(file);
    }
  } catch (e) {
    console.warn(`Failed to get path for ${file.name}`, e);
  }
  // Fallback for development/legacy
  return (file as File & { path: string }).path;
};

export async function readFilesByPath(paths: string[]): Promise<LogFileContext[]> {
  const processedFiles: LogFileContext[] = [];
  const failures: Error[] = [];

  for (const path of paths) {
    try {
      console.log(`[FileLoader] Reading ${path}`);
      // One dropped file can yield many: an archive contributes every log it
      // holds, not just system_logs.txt.
      const extracted = await window.api.readLogFile(path);

      for (const entry of extracted) {
        processedFiles.push({
          id: `${path}::${entry.name}`,
          name: entry.name,
          content: entry.content,
          imageDataUrl: entry.imageDataUrl
        });
      }
    } catch (err) {
      console.error(`Error reading file ${path}:`, err);
      failures.push(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // Surface the real reason instead of letting the caller report the generic
  // "no valid content" when every file failed.
  if (processedFiles.length === 0 && failures.length > 0) {
    throw failures[0];
  }

  return processedFiles;
}

export async function readFiles(files: File[]): Promise<LogFileContext[]> {
  const paths: string[] = [];

  for (const file of files) {
    const path = getPath(file);
    if (!path) {
      console.error(`Could not determine path for file ${file.name}`);
      continue;
    }
    paths.push(path);
  }

  if (paths.length === 0 && files.length > 0) {
    throw new Error(`Could not determine a path for ${files[0].name}`);
  }

  rememberFiles(paths.map((path) => ({ path, name: path.split(/[\\/]/).pop() ?? path })));
  return readFilesByPath(paths);
}
