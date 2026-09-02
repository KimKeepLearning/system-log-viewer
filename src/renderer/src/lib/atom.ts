import { atom } from "jotai";
import { DeviceInfo, IUserLog, LogFileContext, SectionStats } from "./typings";
import { parseDeviceInfo } from "./log-parser";

// Raw log files
export const logFilesAtom = atom<LogFileContext[]>([]);

export const baseDeviceInfoAtom = atom<DeviceInfo>((get) => {
  const files = get(logFilesAtom);
  if (files.length === 0) {
    return { board: "unknown", version: "unknown", arcStatus: "unknown" } as unknown as DeviceInfo;
  }
  // Use the first file for device info, or maybe aggregate?
  // Usually the system dump has the info header.
  return parseDeviceInfo(files[0].content);
});

// Images pulled out of the loaded archives, e.g. the feedback screenshot.
export const screenshotsAtom = atom((get) =>
  get(logFilesAtom).filter((file) => Boolean(file.imageDataUrl))
);

// A map of all parsed logs, keyed by "FileName::SectionName"
// Now a state atom, set by loadLogFilesAtom
export const parsedLogsMapAtom = atom<Record<string, IUserLog[]>>({});

// Derived atom to get the hierarchical structure of logs for UI
// Now a state atom, set by loadLogFilesAtom
export const logStructureAtom = atom<Record<string, string[]>>({});

// Derived atom to get the list of available log keys (flat list of composite keys)
export const logKeysAtom = atom<string[]>((get) => {
  const map = get(parsedLogsMapAtom);
  return Object.keys(map);
});

// Action atom to set processed logs directly
export const setProcessedLogsAtom = atom(
  null,
  (
    _get,
    set,
    data: {
      files: LogFileContext[];
      parsedLogs: Record<string, IUserLog[]>;
      structure: Record<string, string[]>;
      sectionStats: Record<string, SectionStats>;
    }
  ) => {
    set(logFilesAtom, data.files);
    set(parsedLogsMapAtom, data.parsedLogs);
    set(logStructureAtom, data.structure);
    set(sectionStatsAtom, data.sectionStats);
  }
);

// Deprecated: use processFilesAsync and setProcessedLogsAtom instead
export const loadLogFilesAtom = atom(null, (_get, set, files: LogFileContext[]) => {
  set(logFilesAtom, files);
  // Logic moved to log-processor.ts for async handling
  console.warn("loadLogFilesAtom is deprecated. Use async processing.");
});

export const searchQueryAtom = atom<string>("");
export const searchMatchesCountAtom = atom<number>(0);
export const currentMatchIndexAtom = atom<number>(0);
export const activeTabAtom = atom<string>("");

/**
 * "highlight" walks matches in place, which is what the viewer has always done.
 * "filter" drops everything else, which is the only way to get from a few
 * hundred thousand lines down to the handful worth reading.
 */
export type SearchMode = "highlight" | "filter";
export const searchModeAtom = atom<SearchMode>("highlight");

export type LogLevelName = "ERROR" | "WARN" | "INFO" | "DEBUG";

// An empty set means "no level filter", not "hide everything" — that way the
// filter starts off showing the whole log.
export const levelFilterAtom = atom<Set<LogLevelName>>(new Set<LogLevelName>());
export const processFilterAtom = atom<Set<string>>(new Set<string>());

/** Subsystem labels the code stamped on a line, e.g. `[AI Subscription]`. */
export const tagFilterAtom = atom<Set<string>>(new Set<string>());

/** Section keys to show; empty means every section of the selected file. */
export const sectionFilterAtom = atom<Set<string>>(new Set<string>());

/** Inclusive epoch-microsecond window, set by dragging across the timeline. */
export const timeRangeAtom = atom<{ from: number; to: number } | null>(null);

/**
 * When the selected line happened, so the timeline can point at it. Lifted out
 * of the list because the strip is its sibling, not its child.
 */
export const selectedTimeAtom = atom<number | null>(null);

export const sectionStatsAtom = atom<Record<string, SectionStats>>({});

export const hasActiveFiltersAtom = atom(
  (get) =>
    get(levelFilterAtom).size > 0 ||
    get(processFilterAtom).size > 0 ||
    get(tagFilterAtom).size > 0 ||
    get(sectionFilterAtom).size > 0 ||
    get(timeRangeAtom) !== null ||
    (get(searchModeAtom) === "filter" && get(searchQueryAtom).length > 0)
);

export const clearFiltersAtom = atom(null, (_get, set) => {
  set(levelFilterAtom, new Set<LogLevelName>());
  set(processFilterAtom, new Set<string>());
  set(tagFilterAtom, new Set<string>());
  set(sectionFilterAtom, new Set<string>());
  set(timeRangeAtom, null);
});
