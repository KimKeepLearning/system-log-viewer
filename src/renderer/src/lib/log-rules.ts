import { IUserLog } from "./typings";
import { sectionNameOf } from "./log-domains";

export interface AnalyzedLog extends IUserLog {
  sourceFile: string;
}

export type RuleSeverity = "critical" | "warning" | "info";

/**
 * Known failure shapes, as data. Each is something a person would otherwise
 * have to remember to grep for, and `why` says what it means so the finding is
 * useful to someone who has not seen it before.
 *
 * Rules are deliberately narrow: a rule that fires on a healthy device is worse
 * than no rule, because it trains people to ignore the panel.
 */
export interface Rule {
  id: string;
  title: string;
  severity: RuleSeverity;
  why: string;
  /** Restrict to sections whose name matches, when the signal is only meaningful there. */
  section?: RegExp;
  pattern: RegExp;
  /** Only count lines at or above this level, when the text alone is ambiguous. */
  minLevel?: "ERROR" | "WARN";
}

export const RULES: Rule[] = [
  {
    id: "kernel-panic",
    title: "Kernel panic",
    severity: "critical",
    why: "The kernel stopped. Everything after this point is from the next boot.",
    // The word boundaries matter: without them "ramoops:" -- the driver that
    // registers panic-log storage on every healthy boot -- reads as "Oops:".
    pattern: /\bkernel panic\b|\bOops:|\bBUG: unable to handle|\bCall Trace:/i
  },
  {
    id: "oom-kill",
    title: "Out of memory killer ran",
    severity: "critical",
    why: "The kernel killed a process to reclaim memory; whatever died did not choose to.",
    pattern: /out of memory|oom-kill|invoked oom-killer|Killed process \d+/i
  },
  {
    id: "ec-panic",
    title: "Embedded controller panic",
    severity: "critical",
    why: "The EC reset itself. Expect power, keyboard or battery misbehaviour around this time.",
    pattern: /panicinfo|ec panic|EC reset|watchdog reset/i
  },
  {
    id: "filesystem-error",
    title: "Filesystem error",
    severity: "critical",
    why: "The root filesystem reported corruption or was remounted read-only; data loss is possible.",
    // A bare "I/O error" also appears in USB and camera DBus failures, which
    // have nothing to do with the filesystem; the block-layer wording does not.
    pattern:
      /EXT4-fs error|remount-ro|Buffer I\/O error|blk_update_request: I\/O error|I\/O error, dev |journal aborted/i
  },
  {
    id: "process-crash",
    title: "Process crashed",
    severity: "critical",
    why: "A process died on a signal rather than exiting; a minidump was likely written.",
    pattern: /segfault at|SIGSEGV|SIGABRT|general protection fault|killed by SIGSEGV/i
  },
  {
    id: "ui-restart",
    title: "UI restarted",
    severity: "critical",
    why: "The session was torn down and rebuilt, which the user sees as the screen going black.",
    pattern: /ui-post-stop|Restarting ui|session_manager.*(exiting|aborting)|chrome exited/i
  },
  {
    id: "upstart-job-failed",
    title: "Boot job failed",
    severity: "warning",
    why: "An init job exited non-zero during boot. Some of them are expected to; the job name says which.",
    pattern:
      /init: [\w.-]+ (?:main|pre-start|post-start) process \(\d+\) terminated with status [1-9]/i
  },
  {
    id: "watchdog-missing",
    title: "Watchdog device missing",
    severity: "warning",
    why: "daisydog could not open /dev/watchdog, so the hardware reset path is not armed.",
    pattern: /\/dev\/watchdog\) failed|watchdog.*No such file or directory/i
  },
  {
    id: "tpm-failure",
    title: "TPM or hwsec failure",
    severity: "warning",
    why: "Secure storage is unhappy; sign-in, attestation and encrypted mounts can fail because of it.",
    // `\btpm\b` rather than a bare substring: the VPD dump lists fields such as
    // `clear_tpm_owner_done = (error)`, which is a value, not a failure.
    pattern: /\btpm\b[^=]*(?:failure|failed|error 0x)|TPM_RC_[A-Z]+|\btcsd\b.*(?:fail|error)/i
  },
  {
    id: "no-space",
    title: "Out of disk space",
    severity: "critical",
    why: "A write failed with ENOSPC. Whatever else is going wrong on this device, check the disk first: a full volume makes unrelated things fail in confusing ways.",
    pattern: /No space left on device|\bENOSPC\b/i
  },
  {
    id: "mount-failure",
    title: "Cryptohome mount failed",
    severity: "warning",
    why: "The user's encrypted home could not be mounted, which blocks sign-in.",
    pattern: /PreparePersistentVault failed|mount_performer.*failed|cryptohome.*mount.*fail/i
  },
  {
    id: "gpu-reset",
    title: "Graphics reset",
    severity: "warning",
    why: "The GPU was reset under it; the screen usually freezes for a moment first.",
    pattern: /GPU hang|gpu reset|drm.*reset (?:device|GPU)|\*ERROR\* .*drm/i
  },
  {
    id: "audio-underrun",
    title: "Audio underrun",
    severity: "info",
    why: "Audio buffers ran dry, heard as a click or dropout.",
    pattern: /underrun|xrun|severe underrun/i
  },
  {
    id: "wifi-drop",
    title: "Wi-Fi disconnected",
    severity: "info",
    why: "Association was lost. Repeated entries mean a flapping link rather than a one-off.",
    pattern: /CTRL-EVENT-DISCONNECTED|deauthenticat|disconnect.*reason=\d+/i
  },
  {
    id: "thermal-throttle",
    title: "Thermal throttling",
    severity: "info",
    why: "The device slowed itself to shed heat; user-visible as sluggishness.",
    pattern: /thermal.*(throttl|trip)|cpu.*throttl/i
  }
];

export interface Finding {
  rule: Rule;
  count: number;
  firstTs: number | null;
  lastTs: number | null;
  /** Indices into the array that was analysed, for jumping to the evidence. */
  sampleIndices: number[];
  sampleMessage: string;
  sections: string[];
}

const MAX_SAMPLES = 20;

const passesLevel = (log: AnalyzedLog, rule: Rule): boolean => {
  if (!rule.minLevel) return true;
  if (rule.minLevel === "ERROR") return log.level === "ERROR";
  return log.level === "ERROR" || log.level === "WARN";
};

export const runRules = (logs: AnalyzedLog[]): Finding[] => {
  const found = new Map<string, Finding>();

  for (let index = 0; index < logs.length; index++) {
    const log = logs[index];
    const section = sectionNameOf(log.sourceFile);
    // Matching the message alone keeps a rule from firing on a process name or
    // a path that merely contains the word.
    const text = log.message;

    for (const rule of RULES) {
      if (rule.section && !rule.section.test(section)) continue;
      if (!passesLevel(log, rule)) continue;
      if (!rule.pattern.test(text)) continue;

      const existing = found.get(rule.id);
      if (existing) {
        existing.count++;
        if (existing.sampleIndices.length < MAX_SAMPLES) existing.sampleIndices.push(index);
        if (!existing.sections.includes(section)) existing.sections.push(section);
        if (typeof log.ts === "number") {
          if (existing.firstTs === null || log.ts < existing.firstTs) existing.firstTs = log.ts;
          if (existing.lastTs === null || log.ts > existing.lastTs) existing.lastTs = log.ts;
        }
      } else {
        found.set(rule.id, {
          rule,
          count: 1,
          firstTs: typeof log.ts === "number" ? log.ts : null,
          lastTs: typeof log.ts === "number" ? log.ts : null,
          sampleIndices: [index],
          sampleMessage: text,
          sections: [section]
        });
      }
    }
  }

  const order: Record<RuleSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return [...found.values()].sort(
    (a, b) => order[a.rule.severity] - order[b.rule.severity] || b.count - a.count
  );
};
