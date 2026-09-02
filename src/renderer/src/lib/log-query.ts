import { IUserLog } from "./typings";

/**
 * Regex is a poor default for a log search box: almost nobody remembers the
 * syntax, and one stray character silently matches nothing. This is the syntax
 * people already know from issue trackers and mail clients instead:
 *
 *   mojo pipe          both words, anywhere on the line
 *   "not found"        that exact phrase
 *   -heartbeat         lines that do NOT contain it
 *   level:error        a field; several values of one field are OR-ed
 *   process:chrome     substring match, so `chrome` finds `chrome[1016:1016]`
 *   section:dmesg
 *   tag:"AI Subscription"   a subsystem label the code stamped on the line
 *   /pipe.*closed/     regex, for when it is genuinely the right tool
 */
export const QUERY_FIELDS = ["level", "process", "section", "source", "message", "tag"] as const;

export type QueryField = (typeof QUERY_FIELDS)[number] | "text";
export type TermKind = "substring" | "phrase" | "regex";

export interface QueryTerm {
  field: QueryField;
  value: string;
  negated: boolean;
  kind: TermKind;
  /** Set when `kind` is "regex" and the pattern does not compile. */
  invalid?: boolean;
}

export interface ParsedQuery {
  terms: QueryTerm[];
  isEmpty: boolean;
  /** Human-readable reason the query cannot be honoured as written. */
  error?: string;
}

export interface SearchableLog extends IUserLog {
  sourceFile: string;
}

const isFieldName = (candidate: string): candidate is (typeof QUERY_FIELDS)[number] =>
  (QUERY_FIELDS as readonly string[]).includes(candidate);

/** Splits on whitespace, except inside "quotes" or /slashes/. */
const tokenize = (input: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let delimiter: string | null = null;

  for (const character of input) {
    if (delimiter) {
      current += character;
      if (character === delimiter) delimiter = null;
      continue;
    }

    if (character === '"' || character === "'") {
      delimiter = character;
      current += character;
      continue;
    }

    // A slash only opens a regex at the start of a token, so paths inside a
    // message stay ordinary text.
    if (character === "/" && (current === "" || current === "-" || current.endsWith(":"))) {
      delimiter = "/";
      current += character;
      continue;
    }

    if (character === " " || character === "\t") {
      if (current) tokens.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  if (current) tokens.push(current);
  return tokens;
};

const unwrap = (raw: string): { value: string; kind: TermKind } => {
  if (raw.length > 1) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' || first === "'") && last === first) {
      return { value: raw.slice(1, -1), kind: "phrase" };
    }
    if (first === "/" && last === "/") {
      return { value: raw.slice(1, -1), kind: "regex" };
    }
  }
  // An unclosed quote or slash is a query mid-typing; treat what is there as
  // plain text rather than flashing an error at every keystroke.
  if (raw.length > 0 && (raw[0] === '"' || raw[0] === "'" || raw[0] === "/")) {
    return { value: raw.slice(1), kind: "substring" };
  }
  return { value: raw, kind: "substring" };
};

const parseToken = (token: string): QueryTerm | null => {
  let rest = token;
  let negated = false;

  if (rest.startsWith("-") || rest.startsWith("!")) {
    negated = true;
    rest = rest.slice(1);
  }
  if (!rest) return null;

  let field: QueryField = "text";
  const colon = rest.indexOf(":");
  if (colon > 0) {
    const candidate = rest.slice(0, colon).toLowerCase();
    if (isFieldName(candidate)) {
      field = candidate;
      rest = rest.slice(colon + 1);
    }
  }
  if (!rest) return null;

  const { value, kind } = unwrap(rest);
  if (!value) return null;

  const term: QueryTerm = { field, value, negated, kind };
  if (kind === "regex") {
    try {
      new RegExp(value);
    } catch {
      term.invalid = true;
    }
  }
  return term;
};

export const parseQuery = (input: string): ParsedQuery => {
  const terms = tokenize(input)
    .map(parseToken)
    .filter((term): term is QueryTerm => term !== null);

  const broken = terms.find((term) => term.invalid);
  return {
    terms,
    isEmpty: terms.length === 0,
    error: broken ? `Not a valid regular expression: /${broken.value}/` : undefined
  };
};

const sectionOf = (log: SearchableLog): string =>
  log.sourceFile.split("::").slice(1).join("::") || log.sourceFile;

const fieldText = (log: SearchableLog, field: QueryField): string => {
  switch (field) {
    case "level":
      return log.level ?? "";
    case "process":
      return log.process ?? "";
    case "section":
      return sectionOf(log);
    case "source":
      return log.source ?? "";
    case "message":
      return log.message;
    case "tag":
      return log.tag ?? "";
    default:
      return `${log.timestamp ?? ""} ${log.level ?? ""} ${log.process ?? ""} ${log.source ?? ""} ${log.message}`;
  }
};

const termTester = (term: QueryTerm): ((log: SearchableLog) => boolean) => {
  if (term.kind === "regex") {
    if (term.invalid) return () => true;
    const regex = new RegExp(term.value, "i");
    return (log) => regex.test(fieldText(log, term.field));
  }
  const needle = term.value.toLowerCase();
  return (log) => fieldText(log, term.field).toLowerCase().includes(needle);
};

/**
 * Terms for different fields are AND-ed, several values of the same field are
 * OR-ed -- `level:error level:warn process:chrome` reads the way it looks.
 * Negated terms always subtract.
 */
export const buildMatcher = (parsed: ParsedQuery): ((log: SearchableLog) => boolean) => {
  if (parsed.isEmpty) return () => true;

  const positiveGroups = new Map<QueryField, ((log: SearchableLog) => boolean)[]>();
  const negative: ((log: SearchableLog) => boolean)[] = [];

  for (const term of parsed.terms) {
    const test = termTester(term);
    if (term.negated) {
      negative.push(test);
      continue;
    }
    // Free text is AND-ed word by word, so `mojo pipe` needs both.
    const key = term.field === "text" ? ("text-and" as QueryField) : term.field;
    const group = positiveGroups.get(key);
    if (group) group.push(test);
    else positiveGroups.set(key, [test]);
  }

  const textTests = positiveGroups.get("text-and" as QueryField) ?? [];
  positiveGroups.delete("text-and" as QueryField);
  const orGroups = [...positiveGroups.values()];

  return (log) => {
    for (const test of textTests) if (!test(log)) return false;
    for (const group of orGroups) if (!group.some((test) => test(log))) return false;
    for (const test of negative) if (test(log)) return false;
    return true;
  };
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Patterns to paint on the rendered rows: what the reader asked to find. */
export const highlightPatterns = (parsed: ParsedQuery): RegExp[] => {
  const patterns: RegExp[] = [];
  for (const term of parsed.terms) {
    if (term.negated || term.invalid) continue;
    // Level and section have their own columns; highlighting them adds noise.
    if (term.field === "level" || term.field === "section" || term.field === "tag") continue;
    try {
      patterns.push(new RegExp(term.kind === "regex" ? term.value : escapeRegex(term.value), "gi"));
    } catch {
      // Already reported through ParsedQuery.error.
    }
  }
  return patterns;
};
