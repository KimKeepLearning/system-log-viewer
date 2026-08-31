import { RuleSeverity } from "./log-rules";

/**
 * A full disk is invisible to any rule that reads log lines, because nothing
 * writes "the disk is full" -- the machine just starts failing at unrelated
 * things. The evidence lives in two tables instead: `df` output, and a list of
 * log file sizes. Both are worth checking on every archive.
 */

export interface Filesystem {
  device: string;
  size: string;
  used: string;
  available: string;
  usePercent: number;
  mount: string;
  sizeBytes: number;
}

const UNIT_SCALE: Record<string, number> = {
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4
};

const toBytes = (size: string): number => {
  const match = /^([\d.]+)([KMGT])?$/.exec(size.trim());
  if (!match) return 0;
  return Number(match[1]) * (match[2] ? UNIT_SCALE[match[2]] : 1);
};

// Filesystem Size Used Avail Use% Mounted on
const DF_ROW = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)%\s+(\S.*)$/;

export const parseDiskUsage = (raw: string): Filesystem[] => {
  const filesystems: Filesystem[] = [];

  for (const line of raw.split("\n")) {
    const match = DF_ROW.exec(line.trim());
    if (!match) continue;
    filesystems.push({
      device: match[1],
      size: match[2],
      used: match[3],
      available: match[4],
      usePercent: Number(match[5]),
      mount: match[6],
      sizeBytes: toBytes(match[2])
    });
  }

  return filesystems;
};

export interface LogFileSize {
  kilobytes: number;
  path: string;
}

export const parseLogStats = (raw: string): LogFileSize[] => {
  const files: LogFileSize[] = [];

  for (const line of raw.split("\n")) {
    const match = /^(\d+)\s+(\S.*)$/.exec(line.trim());
    if (!match) continue;
    files.push({ kilobytes: Number(match[1]), path: match[2] });
  }

  return files.sort((a, b) => b.kilobytes - a.kilobytes);
};

export interface StorageFinding {
  id: string;
  title: string;
  severity: RuleSeverity;
  why: string;
  evidence: string;
}

/**
 * Read-only images are full by construction -- a squashfs is packed to its
 * exact size -- so every device would report them and the check would be
 * trained away on the first archive anyone opened.
 */
const isReadOnlyImage = (filesystem: Filesystem): boolean =>
  filesystem.device.startsWith("/dev/loop") ||
  filesystem.mount.startsWith("/run/chromeos-config") ||
  filesystem.mount === "/usr/share/oem" ||
  filesystem.sizeBytes < 10 * 1024 ** 2;

const NEARLY_FULL = 95;
const RUNAWAY_LOG_KB = 50 * 1024;
const RUNAWAY_LOG_SHARE = 0.5;

export const inspectStorage = (diskUsageRaw: string, logStatsRaw: string): StorageFinding[] => {
  const findings: StorageFinding[] = [];

  for (const filesystem of parseDiskUsage(diskUsageRaw)) {
    if (isReadOnlyImage(filesystem) || filesystem.usePercent < NEARLY_FULL) continue;

    const full = filesystem.usePercent >= 100;
    findings.push({
      id: `disk-full:${filesystem.mount}`,
      title: full ? `${filesystem.mount} is full` : `${filesystem.mount} is nearly full`,
      severity: full ? "critical" : "warning",
      why: full
        ? "Writes to this volume fail with ENOSPC. On the encrypted volume that blocks sign-in, because the user's vault cannot be prepared."
        : "There is very little room left; the next thing that writes here is likely to fail.",
      evidence: `${filesystem.device}  ${filesystem.size}  ${filesystem.used} used  ${filesystem.available} free  ${filesystem.usePercent}%  ${filesystem.mount}`
    });
  }

  const logs = parseLogStats(logStatsRaw);
  const biggest = logs[0];
  if (biggest) {
    const total = logs.reduce((sum, file) => sum + file.kilobytes, 0);
    const share = total > 0 ? biggest.kilobytes / total : 0;

    // Both conditions matter: a large share of a small total is normal on a
    // quiet device, and a big file that is one of many is just a busy log.
    if (biggest.kilobytes >= RUNAWAY_LOG_KB && share >= RUNAWAY_LOG_SHARE) {
      findings.push({
        id: "runaway-log",
        title: "One log file is filling the disk",
        severity: "critical",
        why: `It is ${(share * 100).toFixed(1)}% of everything under /var/log. A reboot will not help, because the file stays on disk.`,
        evidence: `${(biggest.kilobytes / 1024).toFixed(0)} MB  ${biggest.path}`
      });
    }
  }

  return findings;
};
