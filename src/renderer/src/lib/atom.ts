import { atom } from "jotai";
import { DeviceInfo, IUserLog } from "./typings";
import { parseAllLogSections, parseDeviceInfo } from "./log-parser";

// Raw log content
export const logContentAtom = atom<string>("");

export const baseDeviceInfoAtom = atom<DeviceInfo>((get) => {
  const logContent = get(logContentAtom);
  return parseDeviceInfo(logContent);
});

// A map of all parsed logs, keyed by their section name
// Derived from logContentAtom to ensure they are always in sync
export const parsedLogsMapAtom = atom<Record<string, IUserLog[]>>((get) => {
  const content = get(logContentAtom);
  if (!content) return {};
  return parseAllLogSections(content);
});

// Derived atom to get the list of available log keys
export const logKeysAtom = atom<string[]>((get) => {
  const map = get(parsedLogsMapAtom);
  // Return keys in insertion order (which generally matches file order)
  return Object.keys(map);
});

// Action atom to load and parse content together
export const loadLogContentAtom = atom(null, (_get, set, content: string) => {
  set(logContentAtom, content);
  // parsedLogsMapAtom is derived, no need to set
});

export const searchQueryAtom = atom<string>("");
export const isRegexAtom = atom<boolean>(false);
export const searchMatchesCountAtom = atom<number>(0);
export const currentMatchIndexAtom = atom<number>(0);
export const activeTabAtom = atom<string>("");
