import { IUserLog } from "@renderer/lib/typings";

export const LogLevelMap: Record<string, string> = {
  ERROR: "text-red-500",
  WARN: "text-yellow-500",
  DEBUG: "text-gray-500",
  INFO: "text-blue-500",
  VERBOSE: "text-gray-400"
};

export const getLevelColor = (level?: string) => {
  if (!level) return "text-gray-500";
  const normalized = level.toUpperCase().trim();
  return LogLevelMap[normalized] || "text-gray-500";
};

export interface LogGroup {
  main: IUserLog;
  count: number;
  children: IUserLog[];
}
