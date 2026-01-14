import { atom } from "jotai";
import { DeviceInfo } from "./typings/device";
import { parseDeviceInfo } from "./log-parser";

export const logContentAtom = atom<string>("");

export const baseDeviceInfoAtom = atom<DeviceInfo>((get) => {
  const logContent = get(logContentAtom);
  return parseDeviceInfo(logContent);
});
