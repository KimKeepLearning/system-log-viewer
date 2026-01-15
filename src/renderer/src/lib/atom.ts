import { atom } from "jotai";
import { DeviceInfo, IUserLog } from "./typings";
import { parseDeviceInfo, parseLogSection } from "./log-parser";

// Raw log content
export const logContentAtom = atom<string>("");

export const baseDeviceInfoAtom = atom<DeviceInfo>((get) => {
  const logContent = get(logContentAtom);
  return parseDeviceInfo(logContent);
});

// State atom to hold parsed logs (Manual Caching)
// We use a separate state atom so valid data persists even if components unmount/remount,
// preventing expensive re-parsing on every tab switch.
export const chromeUserLogAtom = atom<IUserLog[]>([]);
export const chromePreviousUserLogAtom = atom<IUserLog[]>([]);
export const chromeSystemLogAtom = atom<IUserLog[]>([]);
export const chromePreviousSystemLogAtom = atom<IUserLog[]>([]);

// Action atom to load and parse content together
export const loadLogContentAtom = atom(null, (_get, set, content: string) => {
  set(logContentAtom, content);
  // Parse immediately and store the result
  set(chromeUserLogAtom, parseLogSection(content, "chrome_user_log"));
  set(chromePreviousUserLogAtom, parseLogSection(content, "chrome_user_log.PREVIOUS"));
  set(chromeSystemLogAtom, parseLogSection(content, "chrome_system_log"));
  set(chromePreviousSystemLogAtom, parseLogSection(content, "chrome_system_log.PREVIOUS"));
});
