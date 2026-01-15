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
export const loginTimesAtom = atom<string[]>([]);
export const alsaControlsAtom = atom<string[]>([]);
export const apsServerLogAtom = atom<IUserLog[]>([]);
export const audioDiagnosticsLogAtom = atom<string[]>([]);
export const bluetoothLogAtom = atom<IUserLog[]>([]);
export const clobberStateAtom = atom<IUserLog[]>([]);
// Action atom to load and parse content together
export const loadLogContentAtom = atom(null, (_get, set, content: string) => {
  set(logContentAtom, content);
  // Parse immediately and store the result
  set(chromeUserLogAtom, parseLogSection(content, "chrome_user_log"));
  set(chromePreviousUserLogAtom, parseLogSection(content, "chrome_user_log.PREVIOUS"));
  set(chromeSystemLogAtom, parseLogSection(content, "chrome_system_log"));
  set(chromePreviousSystemLogAtom, parseLogSection(content, "chrome_system_log.PREVIOUS"));
  set(
    loginTimesAtom,
    parseLogSection(content, "login-times").map((log) => log.message)
  );
  set(
    alsaControlsAtom,
    parseLogSection(content, "alsa controls").map((log) => log.message)
  );
  set(apsServerLogAtom, parseLogSection(content, "apsserver/apsserver.LATEST"));
  set(
    audioDiagnosticsLogAtom,
    parseLogSection(content, "audio_diagnostics").map((log) => log.message)
  );
  set(bluetoothLogAtom, parseLogSection(content, "bluetooth.log"));
  set(clobberStateAtom, parseLogSection(content, "clobber-state.log"));
});
