import { atom } from "jotai";
import { DeviceInfo, IUserLog } from "./typings";
import { parseDeviceInfo, parseChromeUserLog } from "./log-parser";

// Raw log content
export const logContentAtom = atom<string>("");

// Derived info (memoized by Jotai, but recalculated if unmounted/remounted when dependency changes? No, derived atoms are standard)
export const baseDeviceInfoAtom = atom<DeviceInfo>((get) => {
  const logContent = get(logContentAtom);
  return parseDeviceInfo(logContent);
});

// State atom to hold parsed logs (Manual Caching)
// We use a separate state atom so valid data persists even if components unmount/remount,
// preventing expensive re-parsing on every tab switch.
export const chromeUserLogAtom = atom<IUserLog[]>([]);
export const chromeSystemLogAtom = atom<string[]>([]);

// Action atom to load and parse content together
export const loadLogContentAtom = atom(null, (_get, set, content: string) => {
  set(logContentAtom, content);
  // Parse immediately and store the result
  set(chromeUserLogAtom, parseChromeUserLog(content));
});
