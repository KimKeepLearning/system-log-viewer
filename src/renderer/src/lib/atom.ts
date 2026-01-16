import { atom } from "jotai";
import { DeviceInfo, IUserLog } from "./typings";
import { parseAllLogSections, parseDeviceInfo, parseLogSection } from "./log-parser";

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

// Backward compatibility atoms for specific known logs (derived from the map)
// These allow existing code to work while we transition to dynamic keys
export const chromeUserLogAtom = atom<IUserLog[]>(
  (get) => get(parsedLogsMapAtom)["chrome_user_log"] || []
);
export const chromePreviousUserLogAtom = atom<IUserLog[]>(
  (get) => get(parsedLogsMapAtom)["chrome_user_log.PREVIOUS"] || []
);
export const chromeSystemLogAtom = atom<IUserLog[]>(
  (get) => get(parsedLogsMapAtom)["chrome_system_log"] || []
);
export const chromePreviousSystemLogAtom = atom<IUserLog[]>(
  (get) => get(parsedLogsMapAtom)["chrome_system_log.PREVIOUS"] || []
);
export const loginTimesAtom = atom<string[]>((get) =>
  (get(parsedLogsMapAtom)["login-times"] || []).map((l) => l.message)
);
export const alsaControlsAtom = atom<string[]>((get) =>
  (get(parsedLogsMapAtom)["alsa controls"] || []).map((l) => l.message)
);
export const apsServerLogAtom = atom<IUserLog[]>(
  (get) => get(parsedLogsMapAtom)["apsserver/apsserver.LATEST"] || []
);
export const audioDiagnosticsLogAtom = atom<IUserLog[]>(
  (get) => get(parsedLogsMapAtom)["audio_diagnostics"] || []
);
export const bluetoothLogAtom = atom<IUserLog[]>(
  (get) => get(parsedLogsMapAtom)["bluetooth.log"] || []
);
export const clobberStateAtom = atom<IUserLog[]>(
  (get) => get(parsedLogsMapAtom)["clobber-state.log"] || []
);

// Action atom to load and parse content together
export const loadLogContentAtom = atom(null, (_get, set, content: string) => {
  set(logContentAtom, content);
  // parsedLogsMapAtom is derived, no need to set
});