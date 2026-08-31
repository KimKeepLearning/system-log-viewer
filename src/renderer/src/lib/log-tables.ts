/**
 * Several sections are tables, not logs. Read line by line they say nothing;
 * read as columns they answer questions the log itself cannot -- how long boot
 * took and which step was slow, whether the CPU was pinned low, whether the
 * machine was swapping.
 */

export interface BootstatStep {
  event: string;
  /** Milliseconds since boot when the event was recorded. */
  timeMs: number;
  /** Milliseconds spent since the previous event. */
  deltaMs: number;
  cpuPercent: number;
}

// time %cpu       dt  %dt  event
//     1671  11%     1671  11%  pre-startup
const BOOTSTAT_ROW = /^\s*(\d+)\s+(\d+)%\s+(\d+)\s+(\d+)%\s+(\S.*?)\s*$/;

export const parseBootstat = (raw: string): BootstatStep[] => {
  const steps: BootstatStep[] = [];

  for (const line of raw.split("\n")) {
    const match = BOOTSTAT_ROW.exec(line);
    if (!match) continue;
    steps.push({
      timeMs: Number(match[1]),
      cpuPercent: Number(match[2]),
      deltaMs: Number(match[3]),
      event: match[5]
    });
  }

  return steps;
};

export interface BootSummary {
  steps: BootstatStep[];
  /** The first time the login prompt appeared; the number people mean by "boot time". */
  loginPromptMs: number | null;
  /** Steps that dominated, largest first. */
  slowest: BootstatStep[];
}

const SLOW_STEP_MS = 1000;

export const summariseBoot = (raw: string): BootSummary | null => {
  const steps = parseBootstat(raw);
  if (steps.length === 0) return null;

  // bootstat records an event every time it happens, and login-prompt-visible
  // recurs on sign-out. The first one is boot; a later one is a new session.
  const login = steps.find((step) => step.event === "login-prompt-visible");

  return {
    steps,
    loginPromptMs: login ? login.timeMs : null,
    slowest: [...steps]
      .filter((step) => step.deltaMs >= SLOW_STEP_MS)
      .sort((a, b) => b.deltaMs - a.deltaMs)
      .slice(0, 5)
  };
};

export interface SamplerRow {
  /** Epoch microseconds, resolved against a reference from the same log. */
  ts: number;
  values: Record<string, number>;
}

export interface SamplerSeries {
  columns: string[];
  rows: SamplerRow[];
}

// [0831/061736] 3983 0 0 0.25 1008000 ...
const VMLOG_ROW = /^\[(\d{2})(\d{2})\/(\d{2})(\d{2})(\d{2})\]\s+(.*)$/;

/**
 * vmlog samples the machine every couple of seconds but stamps rows with only
 * month, day and time. The year is taken from a timestamp elsewhere in the same
 * log; without a reference the rows cannot be placed on the timeline at all.
 */
export const parseVmlog = (raw: string, referenceTs: number): SamplerSeries | null => {
  const lines = raw.split("\n");
  const header = lines.find((line) => line.trim().startsWith("time "));
  if (!header) return null;

  const columns = header.trim().split(/\s+/).slice(1);
  const referenceYear = new Date(referenceTs / 1000).getUTCFullYear();
  const rows: SamplerRow[] = [];

  for (const line of lines) {
    const match = VMLOG_ROW.exec(line.trim());
    if (!match) continue;

    const [, month, day, hour, minute, second, rest] = match;
    const ts =
      Date.UTC(
        referenceYear,
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
      ) * 1000;

    const numbers = rest.trim().split(/\s+/).map(Number);
    if (numbers.some(Number.isNaN)) continue;

    const values: Record<string, number> = {};
    columns.forEach((column, index) => {
      if (index < numbers.length) values[column] = numbers[index];
    });

    rows.push({ ts, values });
  }

  return rows.length > 0 ? { columns, rows } : null;
};

export interface SamplerStat {
  column: string;
  min: number;
  max: number;
  mean: number;
  /** When the maximum was sampled, for jumping to that moment. */
  peakTs: number;
}

export const summariseSeries = (series: SamplerSeries, column: string): SamplerStat | null => {
  let min = Infinity;
  let max = -Infinity;
  let total = 0;
  let count = 0;
  let peakTs = 0;

  for (const row of series.rows) {
    const value = row.values[column];
    if (typeof value !== "number") continue;
    if (value < min) min = value;
    if (value > max) {
      max = value;
      peakTs = row.ts;
    }
    total += value;
    count++;
  }

  if (count === 0) return null;
  return { column, min, max, mean: total / count, peakTs };
};
