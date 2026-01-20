import { useMemo } from "react";
import { ExtendedLog } from "../types";

export const useLogSearch = (allLogs: ExtendedLog[], searchQuery: string, isRegex: boolean) => {
  return useMemo(() => {
    if (!searchQuery) return [];

    const indices: number[] = [];
    const queryLower = searchQuery.toLowerCase();

    let regex: RegExp | null = null;
    if (isRegex) {
      try {
        regex = new RegExp(searchQuery, "i");
      } catch {
        // invalid regex
      }
    }

    allLogs.forEach((log, index) => {
      // Build a search string similar to what the user sees
      const content = [log.timestamp, log.level, log.process, log.source, log.message]
        .filter(Boolean)
        .join(" ");

      if (regex) {
        if (regex.test(content)) indices.push(index);
      } else {
        if (content.toLowerCase().includes(queryLower)) indices.push(index);
      }
    });
    return indices;
  }, [allLogs, searchQuery, isRegex]);
};
