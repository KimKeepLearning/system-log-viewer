import { sectionNameOf } from "./log-domains";
import { AnalyzedLog } from "./log-rules";
import { findSectionKeys, SectionMap, sectionText } from "./log-sections";

/**
 * Every crash the archive can prove, from three kinds of evidence: lines that
 * announce one (crash_reporter, the kernel, upstart, logcat), sections that hold
 * the dump itself (console-ramoops, EC panicinfo, i915 error state), and the
 * crash_reporter .meta files a /var/log tarball or the SSH preset brings along.
 *
 * A feedback report carries no .meta files and Chrome sends crash IDs out of
 * band, so for most archives the log lines are the only record there is.
 */
export type CrashKind = "process" | "service" | "kernel" | "firmware" | "gpu" | "android";

export interface CrashRecord {
  ts: number | null;
  kind: CrashKind;
  title: string;
  detail: string;
  /** Section the evidence came from. */
  section: string;
  /** Index into the analysed logs, when the evidence is a line. */
  logIndex?: number;
  /** The dump or .meta text, when the evidence is a section. */
  raw?: string;
}

const SIGNALS: Record<string, string> = {
  "4": "SIGILL",
  "5": "SIGTRAP",
  "6": "SIGABRT",
  "7": "SIGBUS",
  "8": "SIGFPE",
  "9": "SIGKILL",
  "11": "SIGSEGV",
  "31": "SIGSYS"
};

const signalName = (signal: string): string => SIGNALS[signal] ?? `signal ${signal}`;

interface LinePattern {
  kind: CrashKind;
  pattern: RegExp;
  read: (match: RegExpExecArray) => { title: string; detail: string; pid?: string };
}

const LINE_PATTERNS: LinePattern[] = [
  {
    // crash-reporter/user_collector_base.cc: LogCrash
    kind: "process",
    pattern:
      /Received crash notification for (\S+?)\[(\d+)\] sig (\d+)(?:, user \d+ group \d+)?(?: \(([^)]*)\))?/,
    read: (m) => ({ title: `${m[1]} ${signalName(m[3])}`, detail: m[4] ?? "", pid: m[2] })
  },
  {
    kind: "process",
    pattern: /^(\S+?)\[(\d+)\]: segfault at (\S+) ip (\S+)/,
    read: (m) => ({ title: `${m[1]} segfault`, detail: `at ${m[3]} ip ${m[4]}`, pid: m[2] })
  },
  {
    kind: "gpu",
    pattern: /GPU process exited unexpectedly: exit_code=(-?\d+)/,
    read: (m) => ({ title: "GPU process exited", detail: `exit_code=${m[1]}` })
  },
  {
    // SIGTERM and SIGKILL are how upstart stops jobs, so only faults count.
    kind: "service",
    pattern:
      /init: (\S+) (?:main|pre-start|post-start|pre-stop|post-stop) process \((\d+)\) killed by (SEGV|ABRT|BUS|ILL|FPE|TRAP|SYS) signal/,
    read: (m) => ({ title: `${m[1]} SIG${m[3]}`, detail: "upstart job", pid: m[2] })
  },
  {
    kind: "kernel",
    pattern: /^Kernel panic - not syncing: (.*)$/,
    read: (m) => ({ title: "Kernel panic", detail: m[1] })
  },
  {
    kind: "android",
    pattern: /^FATAL EXCEPTION: (.*)$/,
    read: (m) => ({ title: "Java crash", detail: `thread ${m[1]}` })
  },
  {
    kind: "android",
    pattern: /Fatal signal (\d+) \((\w+)\).*?pid (\d+) \(([^)]+)\)/,
    read: (m) => ({ title: `${m[4]} ${m[2]}`, detail: "native crash", pid: m[3] })
  },
  {
    kind: "android",
    pattern: /^ANR in (\S+)/,
    read: (m) => ({ title: `ANR in ${m[1]}`, detail: "" })
  }
];

// syslog relays kernel lines that dmesg also holds, and crash_reporter logs
// the same crash the kernel reported a moment earlier.
const SAME_CRASH_US = 10_000_000;

const fromLines = (logs: AnalyzedLog[]): CrashRecord[] => {
  const records: CrashRecord[] = [];
  const seen = new Map<string, CrashRecord>();

  for (let index = 0; index < logs.length; index++) {
    const log = logs[index];
    if (!log.message) continue;

    for (const { kind, pattern, read } of LINE_PATTERNS) {
      const match = pattern.exec(log.message);
      if (!match) continue;

      const { title, detail, pid } = read(match);
      const ts = typeof log.ts === "number" && log.tsKind === "wall" ? log.ts : null;
      const dedupeKey = pid ? `pid:${pid}` : `${kind}:${title}`;
      const previous = seen.get(dedupeKey);

      if (
        previous &&
        (previous.ts === null || ts === null || Math.abs(previous.ts - ts) < SAME_CRASH_US)
      ) {
        if (detail && !previous.detail.includes(detail)) {
          previous.detail = previous.detail ? `${previous.detail} · ${detail}` : detail;
        }
        break;
      }

      const record: CrashRecord = {
        ts,
        kind,
        title,
        detail,
        section: sectionNameOf(log.sourceFile),
        logIndex: index
      };
      seen.set(dedupeKey, record);
      records.push(record);
      break;
    }
  }

  return records;
};

const firstLines = (text: string, count: number): string =>
  text.split("\n").slice(0, count).join("\n");

const PANIC_IN_CONSOLE =
  /Kernel panic - not syncing.*|Oops:.*|BUG: .*|watchdog: .*(?:hard|soft) LOCKUP.*/;

/** debugd writes some dumps as "<base64>: …"; the decoded size says whether there is anything in them. */
const base64Payload = (text: string): Uint8Array | null => {
  const match = /^<base64>:\s*(\S+)/.exec(text.trim());
  if (!match) return null;
  try {
    return Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
};

const hexPreview = (bytes: Uint8Array, length = 64): string =>
  Array.from(bytes.subarray(0, length), (byte) => byte.toString(16).padStart(2, "0")).join(" ");

// An empty xz stream is 32 bytes; anything this small has no error state in it.
const MIN_GPU_DUMP_BYTES = 64;

export const parseCrashMeta = (text: string): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const separator = line.indexOf("=");
    if (separator > 0) fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
};

const fromSections = (sections: SectionMap): CrashRecord[] => {
  const records: CrashRecord[] = [];

  for (const key of findSectionKeys(sections, /^kernel-crashes$|\.kcrash$/)) {
    const text = sectionText(sections, key);
    if (!text.trim()) continue;
    records.push({
      ts: null,
      kind: "kernel",
      title: "Kernel crash dump",
      detail: text.match(PANIC_IN_CONSOLE)?.[0] ?? "",
      section: key,
      raw: firstLines(text, 400)
    });
  }

  // pstore keeps the previous boot's console on every warm reboot, so the
  // section alone proves nothing; a panic or lockup inside it does.
  for (const key of findSectionKeys(sections, /^console-ramoops/)) {
    const text = sectionText(sections, key);
    const panic = text.match(PANIC_IN_CONSOLE)?.[0];
    if (!panic) continue;
    records.push({
      ts: null,
      kind: "kernel",
      title: "Previous boot ended in a kernel failure",
      detail: panic,
      section: key,
      raw: firstLines(text.slice(Math.max(0, text.indexOf(panic) - 4000)), 200)
    });
  }

  // On boards without that MCU the section holds ectool's error instead.
  for (const key of ["cros_ec_panicinfo", "cros_fp_panicinfo"]) {
    const text = sectionText(sections, key);
    const bytes = base64Payload(text);
    if (!(bytes && bytes.length > 0) && !/panic data|exception|PC=/i.test(text)) continue;
    records.push({
      ts: null,
      kind: "firmware",
      title: key === "cros_ec_panicinfo" ? "EC panic info" : "Fingerprint MCU panic info",
      detail: bytes ? `${bytes.length} bytes` : firstLines(text.trim(), 1),
      section: key,
      raw: bytes ? hexPreview(bytes, 256) : firstLines(text, 100)
    });
  }

  const gpu = sectionText(sections, "i915_error_state");
  const gpuBytes = base64Payload(gpu);
  if (gpuBytes && gpuBytes.length >= MIN_GPU_DUMP_BYTES) {
    records.push({
      ts: null,
      kind: "gpu",
      title: "i915 GPU error state",
      detail: `${gpuBytes.length} bytes, xz-compressed: base64 -d | xz -d to read`,
      section: "i915_error_state"
    });
  }

  const anr = sectionText(sections, "VibeAndroidContainer ANR");
  if (anr.trim()) {
    records.push({
      ts: null,
      kind: "android",
      title: "VAC ANR traces",
      detail: anr.match(/^Cmd line: (.*)$/m)?.[1] ?? "",
      section: "VibeAndroidContainer ANR",
      raw: firstLines(anr, 200)
    });
  }

  for (const key of findSectionKeys(sections, /\.meta$/)) {
    const meta = parseCrashMeta(sectionText(sections, key));
    const exec = meta.exec_name ?? key.split("/").pop() ?? key;
    const millis = Number(meta.upload_var_reportTimeMillis);
    records.push({
      ts: Number.isFinite(millis) && millis > 0 ? millis * 1000 : null,
      kind: exec === "kernel" ? "kernel" : "process",
      title: meta.sig ? `${exec} · ${meta.sig}` : exec,
      detail: [
        meta.ver && `ver ${meta.ver}`,
        meta.upload_var_collector && `collector ${meta.upload_var_collector}`,
        meta.payload && meta.payload.split("/").pop(),
        meta.done !== "1" && "not finished"
      ]
        .filter(Boolean)
        .join(" · "),
      section: key,
      raw: sectionText(sections, key)
    });
  }

  return records;
};

export const findCrashes = (logs: AnalyzedLog[], sections: SectionMap): CrashRecord[] =>
  [...fromSections(sections), ...fromLines(logs)].sort(
    (a, b) => (a.ts ?? Number.MAX_SAFE_INTEGER) - (b.ts ?? Number.MAX_SAFE_INTEGER)
  );
