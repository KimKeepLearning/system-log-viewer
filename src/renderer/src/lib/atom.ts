import { atom } from "jotai";
import { DeviceInfo, IUserLog, LogFileContext } from "./typings";
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
    }
  ) => {
    set(logFilesAtom, data.files);
    set(parsedLogsMapAtom, data.parsedLogs);
    set(logStructureAtom, data.structure);
  }
);

// Deprecated: use processFilesAsync and setProcessedLogsAtom instead
export const loadLogFilesAtom = atom(null, (_get, set, files: LogFileContext[]) => {
  set(logFilesAtom, files);
  // Logic moved to log-processor.ts for async handling
  console.warn("loadLogFilesAtom is deprecated. Use async processing.");
});

export const searchQueryAtom = atom<string>("");
export const isRegexAtom = atom<boolean>(false);
export const searchMatchesCountAtom = atom<number>(0);
export const currentMatchIndexAtom = atom<number>(0);
export const activeTabAtom = atom<string>("");
