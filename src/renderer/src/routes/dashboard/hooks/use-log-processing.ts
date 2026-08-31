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
          // Only entries the parser placed on the wall clock can be interleaved.
          // Kernel entries qualify once log-processor has anchored them; ones
          // still on the monotonic clock would sort decades before 1970.
          if (log.tsKind === "wall" && typeof log.ts === "number") {
            logsToProcess.push({ key, log });
          }
        });
      });

      // Ascending: oldest to newest. Comparing the raw strings would be wrong —
      // sections use different formats (trailing Z vs a -07:00 offset, differing
      // fractional digits), so lexical order is not chronological order.
      logsToProcess.sort((a, b) => (a.log.ts as number) - (b.log.ts as number));
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
