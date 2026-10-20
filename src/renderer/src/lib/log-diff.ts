import { IUserLog, LogFileContext } from "./typings";
import { clusterMessages } from "./log-analysis";
import { sectionNameOf } from "./log-domains";
import { extractSingleLineFields } from "./log-parser";
import { AnalyzedLog, RuleSeverity, runRules } from "./log-rules";

/** Enough to find a line again in the open log: its section and its text. */
export interface Evidence {
  sourceFile: string;
  message: string;
}

export interface SectionCounts {
  lines: number;
  errors: number;
}

/**
 * What survives of an archive for comparison. Small on purpose: the other
 * archive is reduced to this and its lines are dropped, so comparing never
 * holds two full logs in memory.
 */
export interface ArchiveSummary {
  sections: Record<string, SectionCounts>;
  fields: Record<string, string>;
  templates: Record<string, { level: string; count: number; sample: Evidence }>;
  findings: Record<
    string,
    { title: string; severity: RuleSeverity; count: number; sample: Evidence }
  >;
}

export const summariseArchive = (
  files: LogFileContext[],
  parsedLogs: Record<string, IUserLog[]>
): ArchiveSummary => {
  const logs: AnalyzedLog[] = [];
  const sections: Record<string, SectionCounts> = {};

  // Keyed by section name alone: the two archives rarely share file names, and
  // "chrome_user_log" is the same section whichever zip it came out of.
  for (const [key, entries] of Object.entries(parsedLogs)) {
    const counts = (sections[sectionNameOf(key)] ??= { lines: 0, errors: 0 });
    for (const log of entries) {
      logs.push({ ...log, sourceFile: key });
      counts.lines++;
      if (log.level === "ERROR") counts.errors++;
    }
  }

  const fields: Record<string, string> = {};
  for (const file of files) {
    if (file.imageDataUrl) continue;
    for (const field of extractSingleLineFields(file.content)) {
      if (!(field.key in fields)) fields[field.key] = field.value;
    }
  }

  const templates: ArchiveSummary["templates"] = {};
  // Uncapped: a template that missed the cut on one side would otherwise read
  // as "only in the other log".
  for (const cluster of clusterMessages(logs, true, Infinity)) {
    const sample = logs[cluster.sampleIndex];
    templates[cluster.template] = {
      level: cluster.level,
      count: cluster.count,
      sample: { sourceFile: sample.sourceFile, message: sample.message }
    };
  }

  const findings: ArchiveSummary["findings"] = {};
  for (const finding of runRules(logs)) {
    const sample = logs[finding.sampleIndices[0]];
    findings[finding.rule.id] = {
      title: finding.rule.title,
      severity: finding.rule.severity,
      count: finding.count,
      sample: { sourceFile: sample.sourceFile, message: sample.message }
    };
  }

  return { sections, fields, templates, findings };
};

export interface SectionDiff {
  name: string;
  a?: SectionCounts;
  b?: SectionCounts;
}

export interface FieldDiff {
  key: string;
  a?: string;
  b?: string;
}

export interface CountDiff {
  key: string;
  label: string;
  /** Level for a template, severity for a finding. */
  kind: string;
  a: number;
  b: number;
  /** Only from the open archive: the other one's lines are gone. */
  sample?: Evidence;
}

export interface ArchiveDiff {
  sections: SectionDiff[];
  fields: FieldDiff[];
  templates: CountDiff[];
  findings: CountDiff[];
}

// One-sided first -- present here and absent there is the usual answer to "why
// does this one fail" -- then by how far the two sides are apart.
const oneSidedFirst = (a: number, b: number) => ((a === 0) !== (b === 0) ? 0 : 1);

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

/** `a` is the open archive, `b` the one it is compared with. */
export const diffArchives = (a: ArchiveSummary, b: ArchiveSummary): ArchiveDiff => {
  const sectionNames = new Set([...Object.keys(a.sections), ...Object.keys(b.sections)]);
  const sections = [...sectionNames]
    .map((name) => ({ name, a: a.sections[name], b: b.sections[name] }))
    .sort((x, y) => {
      const xErrors = [x.a?.errors ?? 0, x.b?.errors ?? 0];
      const yErrors = [y.a?.errors ?? 0, y.b?.errors ?? 0];
      return (
        Number(Boolean(x.a && x.b)) - Number(Boolean(y.a && y.b)) ||
        Math.abs(yErrors[1] - yErrors[0]) - Math.abs(xErrors[1] - xErrors[0]) ||
        x.name.localeCompare(y.name)
      );
    });

  const fieldKeys = new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]);
  const fields = [...fieldKeys]
    .filter((key) => a.fields[key] !== b.fields[key])
    .sort((x, y) => x.localeCompare(y))
    .map((key) => ({ key, a: a.fields[key], b: b.fields[key] }));

  const templateKeys = new Set([...Object.keys(a.templates), ...Object.keys(b.templates)]);
  const templates = [...templateKeys]
    .map((key) => {
      const here = a.templates[key];
      const there = b.templates[key];
      return {
        key,
        label: key,
        kind: (here ?? there)!.level,
        a: here?.count ?? 0,
        b: there?.count ?? 0,
        sample: here?.sample
      };
    })
    .filter((entry) => entry.a !== entry.b)
    .sort(
      (x, y) =>
        oneSidedFirst(x.a, x.b) - oneSidedFirst(y.a, y.b) ||
        Math.abs(y.b - y.a) - Math.abs(x.b - x.a) ||
        x.key.localeCompare(y.key)
    );

  const ruleIds = new Set([...Object.keys(a.findings), ...Object.keys(b.findings)]);
  const findings = [...ruleIds]
    .map((key) => {
      const here = a.findings[key];
      const there = b.findings[key];
      const either = (here ?? there)!;
      return {
        key,
        label: either.title,
        kind: either.severity,
        a: here?.count ?? 0,
        b: there?.count ?? 0,
        sample: here?.sample
      };
    })
    .sort(
      (x, y) =>
        oneSidedFirst(x.a, x.b) - oneSidedFirst(y.a, y.b) ||
        SEVERITY_ORDER[x.kind] - SEVERITY_ORDER[y.kind] ||
        Math.abs(y.b - y.a) - Math.abs(x.b - x.a)
    );

  return { sections, fields, templates, findings };
};
