/**
 * Strips what identifies a person or a network before log text leaves the
 * machine. Each distinct value gets a stable placeholder for the whole run, so
 * the model can still tell that two lines name the same account or address.
 *
 * Deliberately conservative about what it touches: version strings, C++
 * namespaces and timestamps look like addresses to a careless pattern, and
 * mangling them would cost more than it protects.
 */

interface Rule {
  kind: string;
  pattern: RegExp;
  /** Which capture group is the sensitive value; the rest of the match is kept. */
  group?: number;
}

const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";

const RULES: Rule[] = [
  { kind: "email", pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { kind: "url-query", pattern: /(https?:\/\/[^\s?#"'<>]+)(\?[^\s"'<>]+)/g, group: 2 },
  { kind: "mac", pattern: /\b(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\b/g },
  // Full eight-group form only: compressed IPv6 cannot be told apart from
  // "cc::" namespaces or clock times without more context than a line has.
  { kind: "ipv6", pattern: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g },
  {
    kind: "ip",
    pattern: new RegExp(`(?<![\\d.])(?:${OCTET}\\.){3}${OCTET}(?![\\d.])`, "g")
  },
  // User hashes in /home/chronos/u-<hash> and cryptohome paths.
  { kind: "hash", pattern: /\b[0-9a-fA-F]{40}(?:[0-9a-fA-F]{24})?\b/g },
  { kind: "ssid", pattern: /\bssid\s*[:=]\s*["']?([^"'\s,;)\]]+)/gi, group: 1 },
  {
    kind: "serial",
    pattern: /\b(?:serial_number|serial|hwid)\s*[:=]\s*["']?([^"'\s,;]+)/gi,
    group: 1
  },
  { kind: "gaia", pattern: /\bgaia[_ ]?id\s*[:=]\s*["']?(\d{6,})/gi, group: 1 }
];

const KEEP_IPS = new Set(["0.0.0.0", "127.0.0.1", "255.255.255.255"]);

export type Redactor = (text: string) => string;

export const createRedactor = (): Redactor => {
  const seen = new Map<string, string>();
  const counters = new Map<string, number>();

  const placeholder = (kind: string, value: string) => {
    const key = `${kind}\u0000${value}`;
    let label = seen.get(key);
    if (!label) {
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      label = `<${kind}-${next}>`;
      seen.set(key, label);
    }
    return label;
  };

  return (text: string) => {
    let result = text;
    for (const rule of RULES) {
      result = result.replace(rule.pattern, (match, ...groups) => {
        if (rule.kind === "ip" && KEEP_IPS.has(match)) return match;
        if (rule.group === undefined) return placeholder(rule.kind, match);
        const value = groups[rule.group - 1] as string | undefined;
        if (!value) return match;
        return match.replace(value, placeholder(rule.kind, value));
      });
    }
    return result;
  };
};
