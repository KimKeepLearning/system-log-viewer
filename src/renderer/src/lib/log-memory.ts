import { parseVmlog, SamplerSeries } from "./log-tables";
import { findSectionKeys, SectionMap, sectionText } from "./log-sections";

/**
 * vmlog is rotated per boot (vmlog.PREVIOUS, vmlog.LATEST, vmlog.1.*, and in a
 * tarball vmlog/vmlog.<stamp>); stitched together they cover every boot the
 * archive kept.
 */
export const vmlogSeries = (sections: SectionMap, referenceTs: number): SamplerSeries | null => {
  let columns: string[] = [];
  const rows = new Map<number, SamplerSeries["rows"][number]>();

  for (const key of findSectionKeys(
    sections,
    /^(?:vmlog\/)?vmlog(?:\.\d+)?\.(?:LATEST|PREVIOUS|\d{8}-\d{6})$/
  )) {
    const series = parseVmlog(sectionText(sections, key), referenceTs);
    if (!series) continue;
    if (columns.length === 0) columns = series.columns;
    for (const row of series.rows) rows.set(row.ts, row);
  }

  if (rows.size === 0) return null;
  return { columns, rows: [...rows.values()].sort((a, b) => a.ts - b.ts) };
};

export interface ProcessMemory {
  name: string;
  megabytes: number;
  fds: number;
  fdLimit: number;
}

// Browser 242 MB, 467 FDs open of 8192
const MEM_USAGE_ROW = /^(.+?)\s+(\d+) MB, (\d+) FDs open of (\d+)$/;

export const parseMemUsage = (raw: string): ProcessMemory[] =>
  raw
    .split("\n")
    .map((line) => MEM_USAGE_ROW.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      name: match[1],
      megabytes: Number(match[2]),
      fds: Number(match[3]),
      fdLimit: Number(match[4])
    }))
    .sort((a, b) => b.megabytes - a.megabytes);

/** /proc/meminfo, in kB. */
export const parseMeminfo = (raw: string): Record<string, number> => {
  const values: Record<string, number> = {};
  for (const line of raw.split("\n")) {
    const match = /^(\w[\w()]*):\s+(\d+)/.exec(line.trim());
    if (match) values[match[1]] = Number(match[2]);
  }
  return values;
};

export interface Pressure {
  kind: "some" | "full";
  avg10: number;
  avg60: number;
  avg300: number;
}

// some avg10=0.00 avg60=0.00 avg300=0.00 total=0
export const parsePsi = (raw: string): Pressure[] => {
  const result: Pressure[] = [];
  for (const line of raw.split("\n")) {
    const match = /^(some|full)\s+avg10=([\d.]+)\s+avg60=([\d.]+)\s+avg300=([\d.]+)/.exec(
      line.trim()
    );
    if (!match) continue;
    result.push({
      kind: match[1] as Pressure["kind"],
      avg10: Number(match[2]),
      avg60: Number(match[3]),
      avg300: Number(match[4])
    });
  }
  return result;
};

export interface MemorySnapshot {
  vmlog: SamplerSeries | null;
  processes: ProcessMemory[];
  meminfo: Record<string, number>;
  pressure: { resource: string; values: Pressure[] }[];
}

export const memorySnapshot = (sections: SectionMap, referenceTs: number): MemorySnapshot => ({
  vmlog: vmlogSeries(sections, referenceTs),
  processes: parseMemUsage(sectionText(sections, "mem_usage")),
  meminfo: parseMeminfo(sectionText(sections, "meminfo")),
  pressure: ["psi_memory", "psi_cpu", "psi_io"]
    .map((key) => ({
      resource: key.replace("psi_", ""),
      values: parsePsi(sectionText(sections, key))
    }))
    .filter((entry) => entry.values.length > 0)
});
