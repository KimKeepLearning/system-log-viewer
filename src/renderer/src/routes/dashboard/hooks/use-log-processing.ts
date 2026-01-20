import { useMemo } from "react";
import { IUserLog } from "@renderer/lib/typings";
import { ExtendedLog } from "../types";

export const useLogProcessing = (
  selectedFileName: string | null,
  isMergedView: boolean,
  logStructure: Record<string, string[]>,
  parsedLogs: Record<string, IUserLog[]>
) => {
  return useMemo(() => {
    if (!selectedFileName) return { allLogs: [], fileIndices: {} };

    const flatLogs: ExtendedLog[] = [];
    const indices: Record<string, number> = {};

    // Only process sections for the selected file
    const keysToProcess = logStructure[selectedFileName] || [];
    const logsToProcess: { key: string; log: IUserLog }[] = [];

    if (isMergedView) {
      keysToProcess.forEach((key) => {
        const logs = parsedLogs[key] || [];
        logs.forEach((log) => {
          // Requirement: Interleave logs with identifiable timestamps into chrome logs
          // Strategy: Discard any log that doesn't have a valid timestamp, not even a random word
          const ts = log.timestamp ? log.timestamp.trim() : "";
          // Heuristic: Must have length, digits, and time separators to be a "timestamp" and not just "eth0:"
          const hasTimeStructure =
            ts.length > 5 &&
            /\d/.test(ts) &&
            (ts.includes(":") || ts.includes("-") || ts.includes("."));

          if (hasTimeStructure) {
            logsToProcess.push({ key, log });
          }
        });
      });

      // Sort by timestamp (Ascending: Oldest to Newest)
      logsToProcess.sort((a, b) => {
        const tA = a.log.timestamp || "";
        const tB = b.log.timestamp || "";
        if (tA < tB) return -1;
        if (tA > tB) return 1;
        return 0;
      });
    } else {
      keysToProcess.forEach((key) => {
        const logs = parsedLogs[key] || [];
        logs.forEach((log) => {
          logsToProcess.push({ key, log });
        });
      });
    }

    for (let i = 0; i < logsToProcess.length; i++) {
      const { key, log: currentHook } = logsToProcess[i];

      if (!isMergedView && indices[key] === undefined) {
        indices[key] = flatLogs.length;
      }

      const lastLog = flatLogs.length > 0 ? flatLogs[flatLogs.length - 1] : null;

      if (
        lastLog &&
        lastLog.message === currentHook.message &&
        lastLog.level === currentHook.level &&
        lastLog.process === currentHook.process &&
        lastLog.sourceFile === key
      ) {
        lastLog.count++;
        lastLog.duplicates.push(currentHook);
      } else {
        flatLogs.push({
          ...currentHook,
          sourceFile: key,
          count: 1,
          duplicates: [],
          id: `${key}-${Math.random().toString(36).substr(2, 9)}`
        });
      }
    }

    return { allLogs: flatLogs, fileIndices: indices };
  }, [logStructure, parsedLogs, selectedFileName, isMergedView]);
};
