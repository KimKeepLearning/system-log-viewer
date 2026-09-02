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
  /** "lifecycle" is what the machine was doing; "problem" is what went wrong. */
  kind: "lifecycle" | "problem";
  severity: "critical" | "warning" | "info";
}

/**
 * State changes rather than failures. They give the axis a story -- booted
 * here, sat idle there, woke up, signed in -- which is usually what locates an
 * incident faster than the failure itself.
 */
const LIFECYCLE_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: "login prompt", pattern: /login-prompt-visible/i },
  { label: "OOBE", pattern: /\boobe-(?:update|skip-postlogin|config)\b/i },
  { label: "session start", pattern: /Starting user session|SessionStarted|Starting session for/i },
  { label: "session end", pattern: /Stopping (?:all )?session|SessionStopped/i },
  { label: "idle", pattern: /User activity stopped/i },
  { label: "active", pattern: /User activity reported/i },
  { label: "suspend", pattern: /^Suspending\b|Starting suspend|PM: suspend entry/i },
  { label: "resume", pattern: /^Resumed\b|PM: suspend exit|Finishing suspend/i },
  { label: "lid closed", pattern: /Lid closed/i },
  { label: "lid opened", pattern: /Lid opened/i },
  { label: "screen off", pattern: /Turning screen off/i },
  // Anchored: a background service logging "shutting down" on a poll loop
  // otherwise contributes a mark every nine seconds and crowds out everything
  // else on the axis.
  { label: "shutdown", pattern: /^(?:Shutting down|Restarting system)\b/i }
];

const MAX_EVENTS = 60;
// Two of the same thing within this window are one moment, not two marks.
const DEDUPE_US = 5_000_000;
// No single label may dominate the axis, however chatty its source is.
const MAX_PER_LABEL = 6;

export const lifecycleEvents = (logs: AnalyzedLog[]): TimelineEvent[] => {
  const events: TimelineEvent[] = [];
  const lastSeen = new Map<string, number>();
  const seenCount = new Map<string, number>();

  for (const log of logs) {
    if (typeof log.ts !== "number" || !log.message) continue;

    for (const { label, pattern } of LIFECYCLE_PATTERNS) {
      if (!pattern.test(log.message)) continue;

      const previous = lastSeen.get(label);
      if (previous !== undefined && log.ts - previous < DEDUPE_US) break;

      const count = seenCount.get(label) ?? 0;
      if (count >= MAX_PER_LABEL) break;

      lastSeen.set(label, log.ts);
      seenCount.set(label, count + 1);
      events.push({ ts: log.ts, label, kind: "lifecycle", severity: "info" });
      break;
    }
  }

  return events;
};

/**
 * The moments worth marking: what the machine was doing, and when a rule with
 * real consequences first fired. Everything else would turn the axis into noise.
 */
export const timelineEvents = (
  sessions: BootSession[],
  findings: Finding[],
  lifecycle: TimelineEvent[] = [],
  capturedAt: number | null = null
): TimelineEvent[] => {
  const events: TimelineEvent[] = sessions.map((session, index) => ({
    ts: session.startTs,
    label: sessions.length > 1 ? `boot ${index + 1}` : "boot",
    kind: "lifecycle" as const,
    severity: "info" as const
  }));

  events.push(...lifecycle);

  if (capturedAt !== null) {
    events.push({
      ts: capturedAt,
      label: "report sent",
      kind: "lifecycle",
      severity: "info"
    });
  }

  for (const finding of findings) {
    if (finding.rule.severity === "info") continue;
    if (finding.firstTs === null) continue;
    events.push({
      ts: finding.firstTs,
      label: finding.rule.title,
      kind: "problem",
      severity: finding.rule.severity
    });
  }

  // Trim by importance, not by time: a chatty lifecycle label must never push a
  // failure off the axis. Only then sort back into chronological order.
  const weight = (event: TimelineEvent) =>
    event.kind === "problem"
      ? 0
      : event.label === "report sent"
        ? 1
        : event.label.startsWith("boot")
          ? 2
          : 3;

  return [...events]
    .sort((a, b) => weight(a) - weight(b))
    .slice(0, MAX_EVENTS)
    .sort((a, b) => a.ts - b.ts);
};

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11
};

/**
 * When the report was taken, from the LOGDATE section -- "Mon Aug 31 07:36:11
 * UTC 2026". It is the moment someone pressed Send, and it is the end of the
 * evidence: nothing after it exists, and anything close before it is what they
 * were looking at when they decided to report.
 *
 * The UTC line is used rather than the local one beneath it, since everything
 * else here is on the same clock.
 */
export const captureTime = (logDateSection: string): number | null => {
  for (const line of logDateSection.split("\n")) {
    const match = /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+UTC\s+(\d{4})$/.exec(
      line.trim()
    );
    if (!match) continue;

    const month = MONTHS[match[1]];
    if (month === undefined) continue;

    return (
      Date.UTC(
        Number(match[6]),
        month,
        Number(match[2]),
        Number(match[3]),
        Number(match[4]),
        Number(match[5])
      ) * 1000
    );
  }
  return null;
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
