import { useMemo, useRef } from "react";
import { IUserLog } from "@renderer/lib/typings";
import { ExtendedLog } from "../types";

// Most rows never fold, and a fresh array each would be one allocation per line
// on a few hundred thousand lines. Replaced on the first duplicate.
const NO_DUPLICATES: IUserLog[] = [];

const fold = (source: { key: string; log: IUserLog }[]): ExtendedLog[] => {
  const rows: ExtendedLog[] = [];
  // Per-section counters, so a row keeps its id across rebuilds; Math.random()
  // ids silently collapsed every expanded row whenever the list was rebuilt.
  const sequence = new Map<string, number>();

  for (let i = 0; i < source.length; i++) {
    const { key, log } = source[i];
    const previous = rows.length > 0 ? rows[rows.length - 1] : null;

    if (
      previous &&
      previous.message === log.message &&
      previous.level === log.level &&
      previous.process === log.process &&
      previous.sourceFile === key
    ) {
      previous.count++;
      if (previous.duplicates === NO_DUPLICATES) previous.duplicates = [log];
      else previous.duplicates.push(log);
      continue;
    }

    const ordinal = sequence.get(key) ?? 0;
    sequence.set(key, ordinal + 1);

    rows.push({
      ...log,
      sourceFile: key,
      count: 1,
      duplicates: NO_DUPLICATES,
      id: `${key}#${ordinal}`
    });
  }

  return rows;
};

const sequentialRows = (keys: string[], parsedLogs: Record<string, IUserLog[]>): ExtendedLog[] => {
  const source: { key: string; log: IUserLog }[] = [];
  for (const key of keys) {
    for (const log of parsedLogs[key] ?? []) source.push({ key, log });
  }
  return fold(source);
};

const mergedRows = (keys: string[], parsedLogs: Record<string, IUserLog[]>): ExtendedLog[] => {
  const source: { key: string; log: IUserLog }[] = [];
  for (const key of keys) {
    for (const log of parsedLogs[key] ?? []) {
      // Only entries the parser placed on the wall clock can be interleaved.
      // Kernel entries qualify once log-processor has anchored them; ones
      // still on the monotonic clock would sort decades before 1970.
      if (log.tsKind === "wall" && typeof log.ts === "number") source.push({ key, log });
    }
  }

  // Ascending: oldest to newest. Comparing the raw strings would be wrong —
  // sections use different formats (trailing Z vs a -07:00 offset, differing
  // fractional digits), so lexical order is not chronological order.
  source.sort((a, b) => (a.log.ts as number) - (b.log.ts as number));
  return fold(source);
};

const EMPTY_ROWS: ExtendedLog[] = [];

export const useLogProcessing = (
  selectedFileName: string | null,
  isMergedView: boolean,
  logStructure: Record<string, string[]>,
  parsedLogs: Record<string, IUserLog[]>
) => {
  const keys = useMemo(
    () => (selectedFileName ? (logStructure[selectedFileName] ?? []) : []),
    [logStructure, selectedFileName]
  );

  const sequential = useMemo(() => sequentialRows(keys, parsedLogs), [keys, parsedLogs]);

  // Merging re-sorts and re-folds the whole file, so it is built once per file
  // and kept: toggling the switch used to pay for a full rebuild each way.
  const mergedCache = useRef<{
    keys: string[];
    parsedLogs: Record<string, IUserLog[]>;
    rows: ExtendedLog[];
  } | null>(null);

  const merged = useMemo(() => {
    if (!isMergedView) return EMPTY_ROWS;

    const cached = mergedCache.current;
    if (cached && cached.keys === keys && cached.parsedLogs === parsedLogs) return cached.rows;

    const rows = mergedRows(keys, parsedLogs);
    mergedCache.current = { keys, parsedLogs, rows };
    return rows;
  }, [keys, parsedLogs, isMergedView]);

  return { allLogs: isMergedView ? merged : sequential };
};
