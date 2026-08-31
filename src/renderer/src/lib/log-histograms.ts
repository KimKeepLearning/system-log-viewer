/**
 * histograms.txt is Chrome's UMA dump: a few thousand named distributions with
 * counts and sums. It is the quantitative half of the archive -- the log says
 * *that* sign-in failed, `Login.FailureReason` says it happened once and
 * `BootTime.Total2` says boot took 9293ms, which is the same number
 * bootstat_summary reports independently.
 */

export interface HistogramBucket {
  low: number;
  high: number;
  count: number;
}

export interface Histogram {
  name: string;
  count: number;
  sum: number;
  buckets: HistogramBucket[];
  type: string;
  /** sum/count, which for a timing histogram is the average duration. */
  mean: number;
}

interface RawHistogram {
  name?: string;
  count?: number;
  sum?: number;
  buckets?: { low?: number; high?: number; count?: number }[];
  params?: { type?: string };
}

export const parseHistograms = (content: string): Histogram[] => {
  let parsed: { histograms?: RawHistogram[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.histograms)) return [];

  return parsed.histograms
    .filter((entry): entry is RawHistogram & { name: string } => Boolean(entry?.name))
    .map((entry) => {
      const count = entry.count ?? 0;
      const sum = entry.sum ?? 0;
      return {
        name: entry.name,
        count,
        sum,
        mean: count > 0 ? sum / count : 0,
        type: entry.params?.type ?? "",
        buckets: (entry.buckets ?? []).map((bucket) => ({
          low: bucket.low ?? 0,
          high: bucket.high ?? 0,
          count: bucket.count ?? 0
        }))
      };
    });
};

export const looksLikeHistograms = (content: string): boolean =>
  content.startsWith("{") && content.includes('"histograms"');

export interface Highlight {
  label: string;
  pattern: RegExp;
  /** How to read the number, since a mean means different things per metric. */
  unit: "ms" | "count" | "code";
  why: string;
}

/**
 * The handful worth surfacing without being asked. Everything else is reachable
 * by search; these are the ones that answer a triage question directly.
 */
export const HIGHLIGHTS: Highlight[] = [
  {
    label: "Boot total",
    pattern: /^BootTime\.Total2$/,
    unit: "ms",
    why: "Firmware to boot-complete, as Chrome measured it."
  },
  {
    label: "Boot kernel",
    pattern: /^BootTime\.Kernel$/,
    unit: "ms",
    why: "Kernel share of boot."
  },
  {
    label: "Boot chrome",
    pattern: /^BootTime\.Chrome$/,
    unit: "ms",
    why: "Chrome's share of boot."
  },
  {
    label: "Sign-in failures",
    pattern: /^Login\.FailureReason$/,
    unit: "count",
    why: "Recorded once per failed sign-in; any entry here means someone could not get in."
  },
  {
    label: "TPM errors",
    pattern: /^Platform\.Trunks\.TpmErrorCode$/,
    unit: "count",
    why: "Non-zero TPM responses. A high count usually accompanies sign-in or attestation trouble."
  },
  {
    label: "Crashes uploaded",
    pattern: /^(?:Platform\.CrOS\.CrashSender|CrashReport)/,
    unit: "count",
    why: "Crash reports the device tried to send."
  },
  {
    label: "Page load errors",
    pattern: /^Net\.ErrorCodesForMainFrame/,
    unit: "code",
    why: "Network failures on main-frame navigations."
  },
  {
    label: "Memory pressure",
    pattern: /^(?:ChromeOS\.)?Memory\.(?:Pressure|Total)/,
    unit: "count",
    why: "How often the device was under memory pressure."
  }
];

export interface HighlightResult {
  highlight: Highlight;
  histogram: Histogram;
}

export const highlightedMetrics = (histograms: Histogram[]): HighlightResult[] => {
  const results: HighlightResult[] = [];

  for (const highlight of HIGHLIGHTS) {
    // The first match is enough; the patterns are written to be specific.
    const histogram = histograms.find(
      (candidate) => highlight.pattern.test(candidate.name) && candidate.count > 0
    );
    if (histogram) results.push({ highlight, histogram });
  }

  return results;
};

export const formatMetric = (value: number, unit: Highlight["unit"]): string => {
  if (unit === "ms") {
    return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
};
