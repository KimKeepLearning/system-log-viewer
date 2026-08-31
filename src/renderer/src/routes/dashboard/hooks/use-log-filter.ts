import { useMemo } from "react";
import { useAtomValue } from "jotai";
import {
  levelFilterAtom,
  processFilterAtom,
  sectionFilterAtom,
  searchQueryAtom,
  searchModeAtom,
  isRegexAtom,
  timeRangeAtom
} from "@renderer/lib/atom";
import { ExtendedLog } from "../types";

export interface FilterResult {
  logs: ExtendedLog[];
  /** How many rows the filters removed; 0 when nothing is filtered. */
  hiddenCount: number;
  /** Every process seen in the unfiltered set, most talkative first. */
  processes: { name: string; count: number }[];
  levelCounts: Record<string, number>;
}

const matcherFor = (query: string, isRegex: boolean): ((log: ExtendedLog) => boolean) => {
  if (isRegex) {
    let regex: RegExp;
    try {
      regex = new RegExp(query, "i");
    } catch {
      // An unfinished pattern should not blank the view while it is being typed.
      return () => true;
    }
    return (log) => regex.test(searchableText(log));
  }

  const needle = query.toLowerCase();
  return (log) => searchableText(log).toLowerCase().includes(needle);
};

const searchableText = (log: ExtendedLog): string =>
  `${log.timestamp ?? ""} ${log.level ?? ""} ${log.process ?? ""} ${log.source ?? ""} ${log.message}`;

/**
 * Search alone only ever moved the cursor; the noise stayed on screen. This
 * narrows the list itself, which is the only way a few hundred thousand lines
 * become readable.
 */
export const useLogFilter = (allLogs: ExtendedLog[]): FilterResult => {
  const levels = useAtomValue(levelFilterAtom);
  const processes = useAtomValue(processFilterAtom);
  const sections = useAtomValue(sectionFilterAtom);
  const query = useAtomValue(searchQueryAtom);
  const mode = useAtomValue(searchModeAtom);
  const isRegex = useAtomValue(isRegexAtom);
  const timeRange = useAtomValue(timeRangeAtom);

  // Derived from the unfiltered set so the choices on offer do not disappear as
  // soon as one of them is picked.
  const facets = useMemo(() => {
    const processCounts = new Map<string, number>();
    const levelCounts: Record<string, number> = {};

    for (const log of allLogs) {
      const level = log.level || "NONE";
      levelCounts[level] = (levelCounts[level] ?? 0) + 1;
      if (log.process) processCounts.set(log.process, (processCounts.get(log.process) ?? 0) + 1);
    }

    return {
      levelCounts,
      processes: [...processCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
    };
  }, [allLogs]);

  const logs = useMemo(() => {
    const filterBySearch = mode === "filter" && query.length > 0;
    if (
      levels.size === 0 &&
      processes.size === 0 &&
      sections.size === 0 &&
      timeRange === null &&
      !filterBySearch
    ) {
      return allLogs;
    }

    const matches = filterBySearch ? matcherFor(query, isRegex) : null;

    return allLogs.filter((log) => {
      if (levels.size > 0 && !levels.has(log.level as never)) return false;
      if (processes.size > 0 && (!log.process || !processes.has(log.process))) return false;
      if (sections.size > 0 && !sections.has(log.sourceFile)) return false;
      if (timeRange) {
        // Lines with no time cannot be placed in a window, so a time filter
        // necessarily excludes them.
        if (typeof log.ts !== "number" || log.ts < timeRange.from || log.ts > timeRange.to) {
          return false;
        }
      }
      if (matches && !matches(log)) return false;
      return true;
    });
  }, [allLogs, levels, processes, sections, timeRange, query, mode, isRegex]);

  return {
    logs,
    hiddenCount: allLogs.length - logs.length,
    processes: facets.processes,
    levelCounts: facets.levelCounts
  };
};
