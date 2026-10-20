import { z } from "zod";
import { IUserLog, LogFileContext } from "./typings";
import { sectionNameOf } from "./log-domains";
import { extractLogSection, parseDeviceInfo } from "./log-parser";
import { captureTime, detectBootSessions } from "./log-analysis";
import { AnalyzedLog, runRules } from "./log-rules";
import { Redactor } from "./log-redact";

export type AiMarkKind = "cause" | "symptom" | "context";

export interface AiMark {
  ref: string;
  key: string;
  index: number;
  kind: AiMarkKind;
  note: string;
}

export const AI_MARK_STYLE: Record<AiMarkKind, { chip: string; border: string }> = {
  cause: { chip: "bg-red-500/15 text-red-600 dark:text-red-400", border: "border-l-red-500" },
  symptom: {
    chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    border: "border-l-amber-500"
  },
  context: { chip: "bg-sky-500/15 text-sky-700 dark:text-sky-400", border: "border-l-sky-500" }
};

const MAX_SEARCH_RESULTS = 100;
const MAX_WINDOW = 150;
const MAX_MESSAGE_CHARS = 400;

const SearchInput = z.object({
  query: z.string(),
  regex: z.boolean(),
  section: z.string().nullable(),
  level: z.string().nullable(),
  limit: z.number().int()
});
const ReadInput = z.object({ ref: z.string(), before: z.number().int(), after: z.number().int() });
const MarkInput = z.object({
  ref: z.string(),
  kind: z.enum(["cause", "symptom", "context"]),
  note: z.string()
});

const iso = (micros: number | null | undefined) =>
  typeof micros === "number" ? new Date(micros / 1000).toISOString().replace(".000Z", "Z") : "-";

const REF = /^s(\d+):(\d+)$/;

/**
 * The model's view of the open archive: an overview to start from and three
 * tools to look further. Lines are addressed as `s<section>:<index>` into the
 * parsed sections, which is stable however the list is filtered or merged.
 */
export const createLogTools = (
  files: LogFileContext[],
  parsedLogs: Record<string, IUserLog[]>,
  redact: Redactor,
  onMark: (mark: AiMark) => void
) => {
  const keys = Object.keys(parsedLogs).filter((key) => parsedLogs[key].length > 0);
  const idOf = new Map(keys.map((key, index) => [key, `s${index}`]));

  const resolve = (ref: string) => {
    const match = REF.exec(ref.trim());
    const key = match ? keys[Number(match[1])] : undefined;
    const index = match ? Number(match[2]) : -1;
    const log = key ? parsedLogs[key][index] : undefined;
    return key && log ? { key, index, log } : null;
  };

  const format = (key: string, index: number, log: IUserLog) =>
    redact(
      [
        `${idOf.get(key)}:${index}`,
        log.timestamp ?? iso(log.ts),
        sectionNameOf(key),
        log.level || "-",
        log.process || "-",
        log.source || "-",
        (log.tag ? `[${log.tag}] ` : "") + log.message.slice(0, MAX_MESSAGE_CHARS)
      ].join(" | ")
    );

  const sectionFilter = (section: string | null) => {
    if (!section) return null;
    const wanted = section.trim();
    return keys.filter(
      (key) => idOf.get(key) === wanted || sectionNameOf(key) === wanted || key === wanted
    );
  };

  const searchLogs = (input: z.infer<typeof SearchInput>) => {
    let test: (text: string) => boolean;
    if (input.regex) {
      let pattern: RegExp;
      try {
        pattern = new RegExp(input.query, "i");
      } catch (error) {
        return `Invalid regex: ${error instanceof Error ? error.message : String(error)}`;
      }
      test = (text) => pattern.test(text);
    } else {
      const needle = input.query.toLowerCase();
      test = (text) => text.toLowerCase().includes(needle);
    }

    const level = input.level?.toUpperCase() || null;
    const scope = sectionFilter(input.section) ?? keys;
    if (scope.length === 0) return `No section matches "${input.section}".`;

    const limit = Math.min(Math.max(input.limit, 1), MAX_SEARCH_RESULTS);
    const hits: string[] = [];
    let total = 0;
    for (const key of scope) {
      const logs = parsedLogs[key];
      for (let index = 0; index < logs.length; index++) {
        const log = logs[index];
        if (level && log.level !== level) continue;
        const text = `${log.message} ${log.source ?? ""} ${log.process ?? ""} ${log.tag ?? ""}`;
        if (!test(text)) continue;
        total++;
        if (hits.length < limit) hits.push(format(key, index, log));
      }
    }

    if (total === 0) return "No matches.";
    return `${total} match${total === 1 ? "" : "es"}${total > hits.length ? `, first ${hits.length}` : ""}:\n${hits.join("\n")}`;
  };

  const readLogs = (input: z.infer<typeof ReadInput>) => {
    const target = resolve(input.ref);
    if (!target) return `Unknown ref ${input.ref}.`;
    const logs = parsedLogs[target.key];
    const from = Math.max(0, target.index - Math.min(Math.max(input.before, 0), MAX_WINDOW));
    const to = Math.min(
      logs.length - 1,
      target.index + Math.min(Math.max(input.after, 0), MAX_WINDOW)
    );
    const lines: string[] = [];
    for (let index = from; index <= to; index++) {
      lines.push(`${index === target.index ? ">" : " "} ${format(target.key, index, logs[index])}`);
    }
    return `${sectionNameOf(target.key)} lines ${from}-${to} of ${logs.length}:\n${lines.join("\n")}`;
  };

  const markLine = (input: z.infer<typeof MarkInput>) => {
    const target = resolve(input.ref);
    if (!target) return `Unknown ref ${input.ref}.`;
    onMark({
      ref: input.ref.trim(),
      key: target.key,
      index: target.index,
      kind: input.kind,
      note: input.note
    });
    return "Marked.";
  };

  const call = (name: string, input: unknown): string => {
    switch (name) {
      case "search_logs":
        return searchLogs(SearchInput.parse(input));
      case "read_logs":
        return readLogs(ReadInput.parse(input));
      case "mark_line":
        return markLine(MarkInput.parse(input));
      default:
        return `Unknown tool ${name}.`;
    }
  };

  const context = () => {
    const text = files.filter((file) => !file.imageDataUrl);
    const device = text.map((file) => parseDeviceInfo(file.content)).find((info) => info.board);
    const captured = text
      .map((file) => captureTime(extractLogSection(file.content, "LOGDATE")))
      .find((value) => value !== null);

    const all: AnalyzedLog[] = [];
    const positions: number[] = [];
    const sections = keys.map((key) => {
      let errors = 0;
      let first: number | null = null;
      let last: number | null = null;
      for (const [index, log] of parsedLogs[key].entries()) {
        all.push({ ...log, sourceFile: key });
        positions.push(index);
        if (log.level === "ERROR") errors++;
        if (typeof log.ts === "number" && log.tsKind === "wall") {
          if (first === null || log.ts < first) first = log.ts;
          if (last === null || log.ts > last) last = log.ts;
        }
      }
      return `${idOf.get(key)} | ${key.replace("::", "/")} | ${parsedLogs[key].length} | ${errors} | ${iso(first)} → ${iso(last)}`;
    });

    const boots = detectBootSessions(all).map(
      (session) =>
        `boot ${session.index + 1}: ${iso(session.startTs)} → ${iso(session.lastTs)}, ${session.ending}`
    );
    const findings = runRules(all).map((finding) => {
      const sample = finding.sampleIndices[0];
      return `${finding.rule.title} (${finding.rule.severity}) ×${finding.count}, first ${iso(finding.firstTs)}, e.g. ${format(all[sample].sourceFile, positions[sample], all[sample])}`;
    });

    return redact(
      [
        "<archive>",
        `Device: ${device?.board ?? "unknown"} ${device?.version ?? ""}`.trim(),
        `Report captured: ${iso(captured)}`,
        boots.length ? `Boots:\n${boots.join("\n")}` : "Boots: none detected",
        findings.length
          ? `Known failure patterns:\n${findings.join("\n")}`
          : "Known failure patterns: none",
        "Sections (id | file/section | lines | errors | wall-clock span):",
        ...sections,
        "</archive>",
        "A line's ref is <section id>:<line index>, e.g. s3:1520."
      ].join("\n")
    );
  };

  return { keys, resolve, call, context };
};
