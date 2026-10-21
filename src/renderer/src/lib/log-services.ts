import { sectionNameOf } from "./log-domains";
import { AnalyzedLog } from "./log-rules";

/**
 * Upstart reports every job that exits badly, respawns or gives up through
 * kernel "init:" lines. Grouped per job they show which services are flapping,
 * which a log read line by line hides among everything else.
 */
export interface ServiceHealth {
  job: string;
  failures: number;
  respawns: number;
  /** Upstart stopped restarting it. */
  gaveUp: boolean;
  lastExit: string;
  firstTs: number | null;
  lastTs: number | null;
  sampleIndex: number;
}

const EXITED =
  /init: (\S+) (?:main|pre-start|post-start|pre-stop|post-stop) process \(\d+\) (?:terminated with status (\d+)|killed by (\w+) signal)/;
const RESPAWNING = /init: (\S+) main process ended, respawning/;
const GAVE_UP = /init: (\S+) respawning too fast, stopped/;

// The upstart section, syslog and dmesg each carry the same init lines; reading
// all three would triple every count.
const preferredSection = (logs: AnalyzedLog[]): string | null => {
  const counts = new Map<string, number>();
  for (const log of logs) {
    if (!log.message || !log.message.includes("init: ")) continue;
    if (!EXITED.test(log.message) && !RESPAWNING.test(log.message) && !GAVE_UP.test(log.message))
      continue;
    counts.set(log.sourceFile, (counts.get(log.sourceFile) ?? 0) + 1);
  }

  const keys = [...counts.keys()];
  const upstart = keys.find((key) => /^upstart(?:\.log)?$/.test(sectionNameOf(key)));
  if (upstart) return upstart;
  return keys.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0] ?? null;
};

// How upstart stops a job, on shutdown or `stop`; not a failure.
const STOP_SIGNALS = new Set(["TERM", "HUP", "INT"]);

export const serviceHealth = (logs: AnalyzedLog[]): ServiceHealth[] => {
  const source = preferredSection(logs);
  if (!source) return [];

  const jobs = new Map<string, ServiceHealth>();
  const entry = (job: string, index: number): ServiceHealth => {
    let health = jobs.get(job);
    if (!health) {
      health = {
        job,
        failures: 0,
        respawns: 0,
        gaveUp: false,
        lastExit: "",
        firstTs: null,
        lastTs: null,
        sampleIndex: index
      };
      jobs.set(job, health);
    }
    const ts = logs[index].ts;
    if (typeof ts === "number") {
      if (health.firstTs === null || ts < health.firstTs) health.firstTs = ts;
      if (health.lastTs === null || ts > health.lastTs) health.lastTs = ts;
    }
    return health;
  };

  for (let index = 0; index < logs.length; index++) {
    const log = logs[index];
    if (log.sourceFile !== source || !log.message) continue;

    const exited = EXITED.exec(log.message);
    if (exited && exited[3] !== undefined && STOP_SIGNALS.has(exited[3])) continue;
    if (exited) {
      const health = entry(exited[1], index);
      health.failures++;
      health.lastExit = exited[2] !== undefined ? `status ${exited[2]}` : `SIG${exited[3]}`;
      continue;
    }

    const respawning = RESPAWNING.exec(log.message);
    if (respawning) {
      entry(respawning[1], index).respawns++;
      continue;
    }

    const gaveUp = GAVE_UP.exec(log.message);
    if (gaveUp) {
      const health = entry(gaveUp[1], index);
      health.gaveUp = true;
      health.sampleIndex = index;
    }
  }

  return [...jobs.values()].sort(
    (a, b) => Number(b.gaveUp) - Number(a.gaveUp) || b.failures - a.failures
  );
};
