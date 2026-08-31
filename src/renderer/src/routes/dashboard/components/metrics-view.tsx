import { useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Search, X } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { Input } from "@renderer/components/ui/input";
import {
  formatMetric,
  Histogram,
  highlightedMetrics,
  parseHistograms
} from "@renderer/lib/log-histograms";

type SortKey = "count" | "mean" | "name";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "count", label: "Most recorded" },
  { key: "mean", label: "Largest mean" },
  { key: "name", label: "Name" }
];

// Enum and sparse histograms key their buckets by a hashed value, so the range
// is an identity rather than a magnitude and reads better as a bare number.
const bucketLabel = (bucket: { low: number; high: number }): string => {
  if (bucket.high - bucket.low <= 1) return String(bucket.low);
  return `${bucket.low}–${bucket.high}`;
};

const Distribution = ({ histogram }: { histogram: Histogram }) => {
  const plottable = histogram.buckets.filter((bucket) => bucket.count > 0);

  if (plottable.length <= 1) {
    return (
      <p className="text-xs text-muted-foreground">
        Every sample landed in one bucket, so there is no distribution to draw &mdash;{" "}
        {histogram.count.toLocaleString()} recorded, all at{" "}
        {bucketLabel(plottable[0] ?? { low: 0, high: 0 })}.
      </p>
    );
  }

  const peak = Math.max(...plottable.map((bucket) => bucket.count));

  return (
    <div className="flex flex-col gap-0.5">
      {plottable.map((bucket) => (
        <div key={`${bucket.low}-${bucket.high}`} className="flex items-center gap-2">
          <span className="text-[10px] font-mono tabular-nums text-muted-foreground w-28 text-right shrink-0 truncate">
            {bucketLabel(bucket)}
          </span>
          <div className="flex-1 min-w-0 h-3 bg-muted/60 rounded-sm overflow-hidden">
            <div
              className="h-full bg-primary/70 rounded-sm"
              style={{ width: `${Math.max(1, (bucket.count / peak) * 100)}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums w-12 text-right shrink-0">
            {bucket.count.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
};

/**
 * histograms.txt is one line of JSON, so the log list rendered it as a single
 * unreadable row. It is a table of distributions, and this shows it as one:
 * pick a counter, see where its samples actually fell.
 */
export const MetricsView = ({ content }: { content: string }) => {
  const histograms = useMemo(() => parseHistograms(content), [content]);
  const highlights = useMemo(() => highlightedMetrics(histograms), [histograms]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("count");
  const [selected, setSelected] = useState<Histogram | null>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? histograms.filter((histogram) => histogram.name.toLowerCase().includes(needle))
      : histograms;

    return [...matching].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "mean") return b.mean - a.mean;
      return b.count - a.count;
    });
  }, [histograms, query, sort]);

  const detail = selected ?? shown[0] ?? null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-2 py-1.5 border-b flex items-center gap-1.5 shrink-0">
        <div className="relative flex items-center flex-1 min-w-0 max-w-md">
          <Search className="absolute left-2 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter counters — try BootTime, Login, Error"
            className="pl-7 pr-7 h-7 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {SORTS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setSort(option.key)}
            className={cn(
              "h-6 px-2 rounded-md text-xs transition-colors",
              sort === option.key
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {option.label}
          </button>
        ))}

        <span className="ml-auto text-xs text-muted-foreground tabular-nums pr-1">
          {shown.length.toLocaleString()} of {histograms.length.toLocaleString()}
        </span>
      </div>

      {highlights.length > 0 && !query && (
        <div className="px-2 py-2 border-b flex gap-2 overflow-x-auto shrink-0">
          {highlights.map(({ highlight, histogram }) => (
            <button
              key={highlight.label}
              type="button"
              onClick={() => setSelected(histogram)}
              className="flex flex-col gap-0.5 rounded-md border px-2 py-1 shrink-0 text-left hover:bg-muted/60 transition-colors"
              title={`${histogram.name} — ${highlight.why}`}
            >
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {highlight.label}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {formatMetric(
                  highlight.unit === "count" ? histogram.count : histogram.mean,
                  highlight.unit
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <div className="w-1/2 min-w-0 border-r">
          <Virtuoso
            data={shown}
            className="h-full scrollbar-container"
            itemContent={(_index, histogram) => (
              <button
                type="button"
                onClick={() => setSelected(histogram)}
                className={cn(
                  "w-full text-left flex items-baseline gap-2 px-2 py-1 border-b border-border/30 min-w-0",
                  detail?.name === histogram.name ? "bg-primary/10" : "hover:bg-muted/50"
                )}
              >
                <span
                  className="text-[11px] font-mono truncate flex-1 min-w-0"
                  title={histogram.name}
                >
                  {histogram.name}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground w-14 text-right shrink-0">
                  n={histogram.count.toLocaleString()}
                </span>
                <span className="text-[10px] tabular-nums w-14 text-right shrink-0">
                  {histogram.mean.toFixed(1)}
                </span>
              </button>
            )}
          />
        </div>

        <div className="w-1/2 min-w-0 overflow-y-auto scrollbar-container p-3">
          {detail ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5 min-w-0">
                <h3 className="text-sm font-semibold font-mono break-all">{detail.name}</h3>
                <p className="text-[10px] text-muted-foreground">{detail.type}</p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md border p-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Recorded
                  </div>
                  <div className="text-sm font-semibold tabular-nums">
                    {detail.count.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Mean
                  </div>
                  <div className="text-sm font-semibold tabular-nums">{detail.mean.toFixed(2)}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Sum
                  </div>
                  <div className="text-sm font-semibold tabular-nums">
                    {detail.sum.toLocaleString()}
                  </div>
                </div>
              </div>

              <Distribution histogram={detail} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              No counter matches &ldquo;{query}&rdquo;.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
