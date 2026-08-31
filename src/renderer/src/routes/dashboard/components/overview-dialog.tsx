import { useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { AlertTriangle, Info, LayoutDashboard, ShieldAlert } from "lucide-react";
import { Button } from "@vibeus/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@renderer/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@renderer/components/ui/tabs";
import { Input } from "@renderer/components/ui/input";
import { cn } from "@renderer/lib/utils";
import { logFilesAtom } from "@renderer/lib/atom";
import { extractLogSection } from "@renderer/lib/log-parser";
import { analyseLogs } from "@renderer/lib/log-analysis";
import { summariseBoot } from "@renderer/lib/log-tables";
import {
  formatMetric,
  highlightedMetrics,
  looksLikeHistograms,
  parseHistograms
} from "@renderer/lib/log-histograms";
import type { RuleSeverity } from "@renderer/lib/log-rules";
import { ExtendedLog } from "../types";

interface OverviewDialogProps {
  logs: ExtendedLog[];
  fileName: string | null;
  onJumpToLog: (log: ExtendedLog) => void;
}

const clock = (micros: number | null): string =>
  micros === null ? "—" : new Date(micros / 1000).toISOString().slice(0, 19).replace("T", " ");

const duration = (ms: number): string =>
  ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)}s`;

const SEVERITY_STYLE: Record<RuleSeverity, { chip: string; Icon: typeof ShieldAlert }> = {
  critical: { chip: "bg-red-500/15 text-red-600 dark:text-red-400", Icon: ShieldAlert },
  warning: { chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400", Icon: AlertTriangle },
  info: { chip: "bg-sky-500/15 text-sky-700 dark:text-sky-400", Icon: Info }
};

const Stat = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="flex flex-col gap-0.5 rounded-md border p-2">
    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    <span className="text-sm font-semibold tabular-nums">{value}</span>
    {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
  </div>
);

// Everything here is computed on open: a pass over a hundred thousand rows is
// about 200ms, which is fine on demand and would not be during load.
function OverviewBody({ logs, fileName, onJumpToLog }: OverviewDialogProps) {
  const logFiles = useAtomValue(logFilesAtom);
  const overview = useMemo(() => analyseLogs(logs), [logs]);

  const boot = useMemo(() => {
    const file = logFiles.find((entry) => entry.name === fileName);
    if (!file) return null;
    return summariseBoot(extractLogSection(file.content, "bootstat_summary"));
  }, [logFiles, fileName]);

  // The UMA dump is a sibling file in the archive, not a section of this one.
  const metrics = useMemo(() => {
    const file = logFiles.find(
      (entry) => !entry.imageDataUrl && looksLikeHistograms(entry.content)
    );
    if (!file) return null;
    const histograms = parseHistograms(file.content);
    return histograms.length > 0
      ? { histograms, highlights: highlightedMetrics(histograms) }
      : null;
  }, [logFiles]);

  const [metricQuery, setMetricQuery] = useState("");
  const shownMetrics = useMemo(() => {
    if (!metrics) return [];
    const needle = metricQuery.trim().toLowerCase();
    const matching = needle
      ? metrics.histograms.filter((histogram) => histogram.name.toLowerCase().includes(needle))
      : metrics.histograms;
    // Busiest first: a counter nobody incremented says nothing.
    return [...matching].sort((a, b) => b.count - a.count).slice(0, 60);
  }, [metrics, metricQuery]);

  const errors = overview.levelCounts.ERROR ?? 0;
  const warnings = overview.levelCounts.WARN ?? 0;
  const spanMs =
    overview.firstTs !== null && overview.lastTs !== null
      ? (overview.lastTs - overview.firstTs) / 1000
      : 0;

  // The project's Tabs is a left rail, not a top strip. `min-w-0` matters as
  // much as the direction: DialogContent lays its children out in a grid, and a
  // grid item keeps min-width:auto, so a long unbroken DBus message stretches
  // the whole dialog rather than being clipped inside it.
  return (
    <Tabs defaultValue="summary" className="min-h-0 min-w-0 items-start">
      <TabsList className="w-32">
        <TabsTrigger value="summary">Summary</TabsTrigger>
        <TabsTrigger value="diagnostics">
          Diagnostics
          {overview.findings.length > 0 && (
            <span className="ml-1 tabular-nums opacity-60">{overview.findings.length}</span>
          )}
        </TabsTrigger>
        <TabsTrigger value="clusters">Repeats</TabsTrigger>
        {boot && <TabsTrigger value="boot">Boot</TabsTrigger>}
        {metrics && <TabsTrigger value="metrics">Metrics</TabsTrigger>}
      </TabsList>

      <div className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto max-h-[58vh] scrollbar-container pr-1">
        <TabsContent value="summary" className="flex flex-col gap-3 m-0">
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Lines" value={overview.lines.toLocaleString()} />
            <Stat label="Sections" value={String(overview.sections)} />
            <Stat
              label="Errors"
              value={errors.toLocaleString()}
              hint={`${warnings.toLocaleString()} warnings`}
            />
            <Stat
              label="Covers"
              value={spanMs > 0 ? duration(spanMs) : "—"}
              hint={overview.sessions.length > 0 ? `${overview.sessions.length} boot` : undefined}
            />
          </div>

          <div className="text-xs text-muted-foreground tabular-nums">
            {clock(overview.firstTs)} → {clock(overview.lastTs)} UTC
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <h4 className="text-xs font-semibold mb-1">Noisiest sections</h4>
              <div className="flex flex-col">
                {overview.noisiestSections.map((section) => (
                  <div key={section.name} className="flex items-baseline gap-2 text-xs py-0.5">
                    <span className="truncate flex-1 min-w-0 font-mono" title={section.name}>
                      {section.name}
                    </span>
                    {section.errors > 0 && (
                      <span className="text-red-500 tabular-nums">{section.errors}</span>
                    )}
                    <span className="text-muted-foreground tabular-nums w-12 text-right">
                      {section.lines.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold mb-1">Most talkative processes</h4>
              <div className="flex flex-col">
                {overview.topProcesses.map((process) => (
                  <div key={process.name} className="flex items-baseline gap-2 text-xs py-0.5">
                    <span className="truncate flex-1 min-w-0 font-mono" title={process.name}>
                      {process.name}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {process.count.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="diagnostics" className="flex flex-col gap-2 m-0">
          {overview.findings.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              None of the known failure patterns appear in this log.
            </p>
          ) : (
            overview.findings.map((finding) => {
              const style = SEVERITY_STYLE[finding.rule.severity];
              return (
                <button
                  key={finding.rule.id}
                  type="button"
                  onClick={() => onJumpToLog(logs[finding.sampleIndices[0]])}
                  className="text-left border rounded-md p-2 hover:bg-muted/60 transition-colors flex flex-col gap-1 min-w-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0",
                        style.chip
                      )}
                    >
                      <style.Icon className="size-3" />
                      {finding.rule.severity}
                    </span>
                    <span className="text-sm font-medium truncate min-w-0">
                      {finding.rule.title}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums ml-auto shrink-0 whitespace-nowrap">
                      {finding.count}× · first {clock(finding.firstTs).slice(11)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{finding.rule.why}</p>
                  <p className="text-[11px] font-mono truncate opacity-70 min-w-0">
                    {finding.sampleMessage}
                  </p>
                </button>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="clusters" className="flex flex-col m-0">
          <p className="text-xs text-muted-foreground mb-2">
            Errors and warnings grouped by shape, so the same failure counts once however far apart
            its repeats are.
          </p>
          {overview.clusters.slice(0, 40).map((cluster) => (
            <button
              key={cluster.template}
              type="button"
              onClick={() => onJumpToLog(logs[cluster.sampleIndex])}
              className="text-left flex items-baseline gap-2 py-1 border-b border-border/40 hover:bg-muted/60 transition-colors min-w-0"
            >
              <span className="tabular-nums text-xs font-medium w-14 text-right shrink-0">
                {cluster.count.toLocaleString()}×
              </span>
              <span
                className={cn(
                  "text-[10px] font-bold w-10 shrink-0",
                  cluster.level === "ERROR" ? "text-red-500" : "text-amber-500"
                )}
              >
                {cluster.level}
              </span>
              <span
                className="text-[11px] font-mono truncate flex-1 min-w-0"
                title={cluster.template}
              >
                {cluster.template}
              </span>
              <span className="text-[10px] text-muted-foreground truncate w-32 shrink-0">
                {cluster.sections.join(", ")}
              </span>
            </button>
          ))}
        </TabsContent>

        {boot && (
          <TabsContent value="boot" className="flex flex-col gap-3 m-0">
            <div className="grid grid-cols-3 gap-2">
              <Stat
                label="To login prompt"
                value={boot.loginPromptMs === null ? "—" : duration(boot.loginPromptMs)}
              />
              <Stat label="Milestones" value={String(boot.steps.length)} />
              <Stat
                label="Slowest step"
                value={boot.slowest[0] ? duration(boot.slowest[0].deltaMs) : "—"}
                hint={boot.slowest[0]?.event}
              />
            </div>

            <div>
              <h4 className="text-xs font-semibold mb-1">Milestones</h4>
              {boot.steps.map((step, index) => {
                const widest = Math.max(...boot.steps.map((other) => other.deltaMs));
                return (
                  <div key={`${step.event}-${index}`} className="flex items-center gap-2 py-0.5">
                    <span className="text-[11px] font-mono truncate w-52 shrink-0 min-w-0">
                      {step.event}
                    </span>
                    <div className="flex-1 h-2.5 bg-muted rounded-sm overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-sm",
                          step.deltaMs === widest ? "bg-red-500" : "bg-primary/60"
                        )}
                        style={{ width: `${Math.max(1, (step.deltaMs / widest) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-muted-foreground w-16 text-right shrink-0">
                      {duration(step.deltaMs)}
                    </span>
                  </div>
                );
              })}
            </div>
          </TabsContent>
        )}

        {metrics && (
          <TabsContent value="metrics" className="flex flex-col gap-3 m-0">
            <p className="text-xs text-muted-foreground">
              Chrome&rsquo;s own counters, from histograms.txt. They put a number on what the log
              only describes &mdash; and are measured independently, so agreeing with the log is
              corroboration.
            </p>

            <div className="grid grid-cols-2 gap-2">
              {metrics.highlights.map(({ highlight, histogram }) => (
                <div
                  key={highlight.label}
                  className="flex flex-col gap-0.5 rounded-md border p-2 min-w-0"
                  title={histogram.name}
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
                  <span className="text-[10px] text-muted-foreground">{highlight.why}</span>
                </div>
              ))}
            </div>

            <div>
              <h4 className="text-xs font-semibold mb-1">
                All counters ({metrics.histograms.length.toLocaleString()})
              </h4>
              <Input
                value={metricQuery}
                onChange={(event) => setMetricQuery(event.target.value)}
                placeholder="Filter by name, e.g. BootTime or Login"
                className="h-7 text-xs mb-1"
              />
              {shownMetrics.map((histogram) => (
                <div
                  key={histogram.name}
                  className="flex items-baseline gap-2 py-0.5 border-b border-border/40 min-w-0"
                >
                  <span
                    className="text-[11px] font-mono truncate flex-1 min-w-0"
                    title={histogram.name}
                  >
                    {histogram.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground tabular-nums w-14 text-right shrink-0">
                    n={histogram.count.toLocaleString()}
                  </span>
                  <span className="text-[10px] tabular-nums w-16 text-right shrink-0">
                    {histogram.mean.toFixed(1)}
                  </span>
                </div>
              ))}
              {shownMetrics.length === 0 && (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  No counter matches &ldquo;{metricQuery}&rdquo;.
                </p>
              )}
            </div>
          </TabsContent>
        )}
      </div>
    </Tabs>
  );
}

export function OverviewDialog(props: OverviewDialogProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="text" className="h-6 text-xs px-2 gap-1" title="Overview and diagnostics">
          <LayoutDashboard className="h-3.5 w-3.5" />
          Overview
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Overview</DialogTitle>
          <DialogDescription>What this log says before you start reading it.</DialogDescription>
        </DialogHeader>

        {isOpen && (
          <OverviewBody
            {...props}
            onJumpToLog={(log) => {
              props.onJumpToLog(log);
              setIsOpen(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
