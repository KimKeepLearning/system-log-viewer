import { sectionNameOf } from "./log-domains";
import { AnalyzedLog, Finding, runRules } from "./log-rules";

/**
 * Turns a message into the shape it shares with its repeats: addresses, ids,
 * pids, paths and numbers vary between occurrences of the same event, so they
 * are what has to go before two lines can be recognised as the same thing.
 *
 * The existing fold only collapses *adjacent* duplicates, which misses the
 * usual form of error spam entirely -- the same failure a thousand times with
 * other traffic in between.
 */
export const messageTemplate = (message: string): string =>
  message
    .replace(/\b0x[0-9a-fA-F]+\b/g, "0xN")
    .replace(
      /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
      "<uuid>"
    )
    .replace(/\b(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\b/g, "<mac>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<ip>")
    .replace(/\/[\w.+-]+(?:\/[\w.+-]+)+/g, "<path>")
    .replace(/\b\d+(?:\.\d+)?(?:ms|us|s|kB|MB|GB)?\b/g, "N")
    .replace(/\s+/g, " ")
    .trim();

export interface Cluster {
  template: string;
  count: number;
  level: string;
  firstTs: number | null;
  lastTs: number | null;
  sampleMessage: string;
  sampleIndex: number;
  sections: string[];
}

const MAX_CLUSTERS = 200;

export const clusterMessages = (logs: AnalyzedLog[], onlyProblems = true): Cluster[] => {
  const clusters = new Map<string, Cluster>();

  for (let index = 0; index < logs.length; index++) {
    const log = logs[index];
    if (onlyProblems && log.level !== "ERROR" && log.level !== "WARN") continue;
    if (!log.message) continue;

    const template = messageTemplate(log.message);
    if (!template) continue;

    const section = sectionNameOf(log.sourceFile);
    const existing = clusters.get(template);
    if (existing) {
      existing.count++;
      if (!existing.sections.includes(section) && existing.sections.length < 6) {
        existing.sections.push(section);
      }
      if (typeof log.ts === "number") {
        if (existing.firstTs === null || log.ts < existing.firstTs) existing.firstTs = log.ts;
        if (existing.lastTs === null || log.ts > existing.lastTs) existing.lastTs = log.ts;
      }
    } else {
      clusters.set(template, {
        template,
        count: 1,
        level: log.level || "",
        firstTs: typeof log.ts === "number" ? log.ts : null,
        lastTs: typeof log.ts === "number" ? log.ts : null,
        sampleMessage: log.message,
        sampleIndex: index,
        sections: [section]
      });
    }
  }

  return [...clusters.values()].sort((a, b) => b.count - a.count).slice(0, MAX_CLUSTERS);
};

export interface BootSession {
  index: number;
  startTs: number;
  endTs: number;
  lines: number;
}

/**
 * Splits the log at the points the kernel announced itself. Most archives hold
 * a single boot; the ones that do not are usually the interesting ones, because
 * the reboot is the event being investigated.
 */
export const detectBootSessions = (logs: AnalyzedLog[]): BootSession[] => {
  const starts: number[] = [];

  // One boot announces itself several times, and syslog relays the same kernel
  // lines with its own later timestamps -- on a real archive the two landed 3.6s
  // apart and read as two reboots. Anything inside this window is one boot; a
  // device that genuinely reboots twice within it is not a case worth splitting.
  const SAME_BOOT_US = 60_000_000;

  for (const log of logs) {
    if (typeof log.ts !== "number") continue;
    if (/^Booting Linux on physical CPU|^Linux version \d/.test(log.message)) {
      if (!starts.some((at) => Math.abs(at - log.ts!) < SAME_BOOT_US)) starts.push(log.ts);
    }
  }

  if (starts.length === 0) return [];
  starts.sort((a, b) => a - b);

  let latest = -Infinity;
  for (const log of logs) if (typeof log.ts === "number" && log.ts > latest) latest = log.ts;

  return starts.map((startTs, index) => {
    const endTs = index + 1 < starts.length ? starts[index + 1] : latest;
    let lines = 0;
    for (const log of logs) {
      if (typeof log.ts === "number" && log.ts >= startTs && log.ts < endTs) lines++;
    }
    return { index, startTs, endTs, lines };
  });
};

export interface TimelineEvent {
  ts: number;
  label: string;
  severity: "critical" | "warning" | "info";
}

const MAX_EVENTS = 40;

/**
 * The handful of moments worth marking on the strip: when the machine booted,
 * and when a rule with real consequences first fired. Everything else would
 * turn the axis into noise.
 */
export const timelineEvents = (sessions: BootSession[], findings: Finding[]): TimelineEvent[] => {
  const events: TimelineEvent[] = sessions.map((session, index) => ({
    ts: session.startTs,
    label: sessions.length > 1 ? `boot ${index + 1}` : "boot",
    severity: "info" as const
  }));

  for (const finding of findings) {
    if (finding.rule.severity === "info") continue;
    if (finding.firstTs === null) continue;
    events.push({
      ts: finding.firstTs,
      label: finding.rule.title,
      severity: finding.rule.severity
    });
  }

  return events.sort((a, b) => a.ts - b.ts).slice(0, MAX_EVENTS);
};

export interface LogOverview {
  lines: number;
  sections: number;
  firstTs: number | null;
  lastTs: number | null;
  levelCounts: Record<string, number>;
  topProcesses: { name: string; count: number }[];
  noisiestSections: { name: string; lines: number; errors: number }[];
  sessions: BootSession[];
  findings: Finding[];
  clusters: Cluster[];
}

export const analyseLogs = (logs: AnalyzedLog[]): LogOverview => {
  const levelCounts: Record<string, number> = {};
  const processCounts = new Map<string, number>();
  const sectionCounts = new Map<string, { lines: number; errors: number }>();

  let firstTs: number | null = null;
  let lastTs: number | null = null;

  for (const log of logs) {
    const level = log.level || "NONE";
    levelCounts[level] = (levelCounts[level] ?? 0) + 1;

    if (log.process) processCounts.set(log.process, (processCounts.get(log.process) ?? 0) + 1);

    const section = sectionNameOf(log.sourceFile);
    const entry = sectionCounts.get(section) ?? { lines: 0, errors: 0 };
    entry.lines++;
    if (log.level === "ERROR") entry.errors++;
    sectionCounts.set(section, entry);

    if (typeof log.ts === "number") {
      if (firstTs === null || log.ts < firstTs) firstTs = log.ts;
      if (lastTs === null || log.ts > lastTs) lastTs = log.ts;
    }
  }

  const sessions = detectBootSessions(logs);

  return {
    lines: logs.length,
    sections: sectionCounts.size,
    firstTs,
    lastTs,
    levelCounts,
    topProcesses: [...processCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    noisiestSections: [...sectionCounts.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.errors - a.errors || b.lines - a.lines)
      .slice(0, 10),
    sessions,
    findings: runRules(logs),
    clusters: clusterMessages(logs)
  };
};
