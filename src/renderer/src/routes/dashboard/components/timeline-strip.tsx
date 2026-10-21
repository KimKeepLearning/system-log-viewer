import { memo, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { selectedTimeAtom, timeRangeAtom, viewportTimeAtom } from "@renderer/lib/atom";
import { sectionNameOf } from "@renderer/lib/log-domains";
import { BootSession, messageTemplate, TimelineEvent } from "@renderer/lib/log-analysis";
import type { SamplerSeries } from "@renderer/lib/log-tables";
import {
  axisTicks,
  buildScale,
  clusterEvents,
  EventCluster,
  TimeScale
} from "@renderer/lib/timeline";
import { Popover, PopoverContent, PopoverTrigger } from "@renderer/components/ui/popover";
import { ExtendedLog } from "../types";

const BUCKET_COUNT = 160;
const MAX_LANES = 8;
// Below this many pixels of travel a press is a click (jump), not a drag (zoom).
const CLICK_SLOP_PX = 4;
const LANES_STORAGE_KEY = "timeline-lanes";
const COMPRESS_STORAGE_KEY = "timeline-compress";

export interface TimelineMark {
  ts: number;
  kind: "cause" | "symptom" | "context" | "bookmark";
  label: string;
  onSelect: () => void;
}

interface Bucket {
  total: number;
  errors: number;
  warnings: number;
  errorTemplates: Set<string>;
  warningTemplates: Set<string>;
  /** Templates whose first appearance in the whole log falls in this bucket. */
  newTemplates: string[];
  sections: Map<string, number>;
}

interface LaneCell {
  total: number;
  errors: number;
  warnings: number;
}

interface Lane {
  key: string;
  total: number;
  errors: number;
  peak: number;
  cells: LaneCell[];
}

const readFlag = (key: string, fallback: boolean): boolean => {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "1";
  } catch {
    return fallback;
  }
};

const writeFlag = (key: string, value: boolean): void => {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Only a remembered preference.
  }
};

const formatClock = (micros: number): string => new Date(micros / 1000).toISOString().slice(11, 19);
const formatDate = (micros: number): string => new Date(micros / 1000).toISOString().slice(0, 10);
const formatDayMonth = (micros: number): string =>
  new Date(micros / 1000).toISOString().slice(5, 10);

const formatMoment = (micros: number, multiDay: boolean): string =>
  multiDay ? `${formatDayMonth(micros)} ${formatClock(micros)}` : formatClock(micros);

const formatSpan = (micros: number): string => {
  const seconds = micros / 1_000_000;
  if (seconds < 90) return `${seconds.toFixed(1)}s`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)}min`;
  if (seconds < 2 * 86_400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86_400).toFixed(1)} days`;
};

const formatTick = (micros: number, step: number): string =>
  step >= 86_400_000_000
    ? formatDayMonth(micros)
    : step >= 60_000_000
      ? formatClock(micros).slice(0, 5)
      : formatClock(micros);

const EVENT_COLOR: Record<TimelineEvent["severity"], string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-sky-500"
};

const MARK_COLOR: Record<TimelineMark["kind"], string> = {
  cause: "bg-red-600",
  symptom: "bg-amber-500",
  context: "bg-sky-500",
  bookmark: "bg-violet-500"
};

const bucketOf = (scale: TimeScale, ts: number): number =>
  Math.min(BUCKET_COUNT - 1, Math.max(0, Math.floor((scale.toX(ts) / 100) * BUCKET_COUNT)));

/**
 * The strip answers "when did new trouble start" rather than "when was the log
 * busy": bars count distinct error shapes, so one failure repeated a thousand
 * times is one, and the darker cap is shapes never seen before that moment.
 * Volume stays as a faint backdrop. Stretches with no log are squeezed out, and
 * search hits, marks, crashes and boots are drawn on top, so the strip shows
 * what you are looking for rather than an even spread of time.
 *
 * Click jumps the log to that moment, drag zooms, double-click resets.
 */
export const TimelineStrip = ({
  logs,
  events = [],
  sessions = [],
  hits = [],
  marks = [],
  resource = null,
  pinnedSections = [],
  onJumpToTime,
  onJumpToHit,
  onSelectEvent
}: {
  logs: ExtendedLog[];
  events?: TimelineEvent[];
  sessions?: BootSession[];
  /** Timestamps of the rows the search matches. */
  hits?: number[];
  marks?: TimelineMark[];
  resource?: SamplerSeries | null;
  /** Sections pinned in the sidebar; they become the lanes when set. */
  pinnedSections?: string[];
  /** With a section, the jump lands on that section's nearest line. */
  onJumpToTime?: (ts: number, section?: string) => void;
  onJumpToHit?: (ts: number) => void;
  onSelectEvent?: (event: TimelineEvent) => void;
}) => {
  const [timeRange, setTimeRange] = useAtom(timeRangeAtom);
  const selectedTime = useAtomValue(selectedTimeAtom);
  const viewport = useAtomValue(viewportTimeAtom);
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; startX: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // The hover card belongs to the main track; over the lanes it would cover the
  // cells being read, which carry their own titles.
  const [hoverOnTrack, setHoverOnTrack] = useState(false);
  const [showLanes, setShowLanes] = useState(() => readFlag(LANES_STORAGE_KEY, false));
  const [compress, setCompress] = useState(() => readFlag(COMPRESS_STORAGE_KEY, true));

  // Independent of zoom, so zooming does not re-template every error line.
  const base = useMemo(() => {
    const timestamps: number[] = [];
    const templates = new Array<string | null>(logs.length).fill(null);
    const firstSeen = new Map<string, number>();

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      if (typeof log.ts !== "number") continue;
      timestamps.push(log.ts);
      if ((log.level !== "ERROR" && log.level !== "WARN") || !log.message) continue;
      const template = `${log.level}:${messageTemplate(log.message)}`;
      templates[i] = template;
      const seen = firstSeen.get(template);
      if (seen === undefined || log.ts < seen) firstSeen.set(template, log.ts);
    }

    timestamps.sort((a, b) => a - b);
    return { timestamps, templates, firstSeen };
  }, [logs]);

  const model = useMemo(() => {
    const { timestamps, templates, firstSeen } = base;
    if (timestamps.length < 2) return null;
    const extentMin = timestamps[0];
    const extentMax = timestamps[timestamps.length - 1];
    if (extentMax <= extentMin) return null;

    // An explicit window becomes the strip's own range, so dragging zooms as
    // well as filters.
    const min = timeRange ? Math.max(extentMin, timeRange.from) : extentMin;
    const max = timeRange ? Math.min(extentMax, timeRange.to) : extentMax;
    if (max <= min) return null;

    const scale = buildScale(timestamps, min, max, compress);
    const buckets: Bucket[] = Array.from({ length: BUCKET_COUNT }, () => ({
      total: 0,
      errors: 0,
      warnings: 0,
      errorTemplates: new Set<string>(),
      warningTemplates: new Set<string>(),
      newTemplates: [],
      sections: new Map<string, number>()
    }));
    const lanes = new Map<string, Lane>();

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      if (typeof log.ts !== "number" || log.ts < min || log.ts > max) continue;
      const index = bucketOf(scale, log.ts);
      const bucket = buckets[index];
      bucket.total++;
      bucket.sections.set(log.sourceFile, (bucket.sections.get(log.sourceFile) ?? 0) + 1);

      const template = templates[i];
      if (template) {
        if (log.level === "ERROR") {
          bucket.errors++;
          bucket.errorTemplates.add(template);
        } else {
          bucket.warnings++;
          bucket.warningTemplates.add(template);
        }
        if (firstSeen.get(template) === log.ts && !bucket.newTemplates.includes(template)) {
          bucket.newTemplates.push(template);
        }
      }

      let lane = lanes.get(log.sourceFile);
      if (!lane) {
        lane = {
          key: log.sourceFile,
          total: 0,
          errors: 0,
          peak: 0,
          cells: Array.from({ length: BUCKET_COUNT }, () => ({ total: 0, errors: 0, warnings: 0 }))
        };
        lanes.set(log.sourceFile, lane);
      }
      const cell = lane.cells[index];
      cell.total++;
      lane.total++;
      if (log.level === "ERROR") {
        cell.errors++;
        lane.errors++;
      } else if (log.level === "WARN") cell.warnings++;
      if (cell.total > lane.peak) lane.peak = cell.total;
    }

    // Pinned sections are what you said you care about; otherwise the sections
    // with the most errors, which is where the story usually is.
    const pinned = pinnedSections
      .map((key) => lanes.get(key))
      .filter((lane): lane is Lane => !!lane);
    const laneList = (
      pinned.length > 0
        ? pinned
        : [...lanes.values()].sort((a, b) => b.errors - a.errors || b.total - a.total)
    ).slice(0, MAX_LANES);

    const distinct = (bucket: Bucket) => bucket.errorTemplates.size + bucket.warningTemplates.size;

    return {
      min,
      max,
      scale,
      buckets,
      peakVolume: Math.max(1, ...buckets.map((bucket) => bucket.total)),
      peakDistinct: Math.max(1, ...buckets.map(distinct)),
      distinct,
      ticks: axisTicks(scale),
      multiDay: formatDate(min) !== formatDate(max),
      isZoomed: timeRange !== null,
      extentSpan: extentMax - extentMin,
      lanes: laneList,
      pinnedLanes: pinned.length > 0,
      laneErrorPeak: Math.max(
        1,
        ...laneList.flatMap((lane) => lane.cells.map((cell) => cell.errors))
      )
    };
  }, [base, logs, timeRange, compress, pinnedSections]);

  const hitCells = useMemo(() => {
    if (!model || hits.length === 0) return null;
    const cells = new Array<number>(BUCKET_COUNT).fill(0);
    for (const ts of hits) {
      if (ts >= model.min && ts <= model.max) cells[bucketOf(model.scale, ts)]++;
    }
    return { cells, peak: Math.max(1, ...cells) };
  }, [model, hits]);

  const clusters = useMemo(
    () => (model ? clusterEvents(events, model.scale) : []),
    [model, events]
  );

  if (!model) return null;
  const { scale } = model;

  const timeAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return model.min;
    return scale.fromX(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };

  const inRange = (ts: number) => ts >= model.min && ts <= model.max;

  const selectionLeft = drag ? scale.toX(Math.min(drag.from, drag.to)) : 0;
  const selectionWidth = drag
    ? Math.max(0.4, scale.toX(Math.max(drag.from, drag.to)) - selectionLeft)
    : 0;

  const hoverBucket = (() => {
    if (hover === null) return null;
    const index = bucketOf(scale, hover);
    const bucket = model.buckets[index];
    const from = scale.fromX((index / BUCKET_COUNT) * 100);
    const to = scale.fromX(((index + 1) / BUCKET_COUNT) * 100);
    return {
      bucket,
      from,
      to,
      hits: hitCells?.cells[index] ?? 0,
      topSections: [...bucket.sections.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
      events: events.filter((event) => event.ts >= from && event.ts < to).slice(0, 4)
    };
  })();

  const toggle = (key: string, value: boolean, set: (value: boolean) => void) => {
    writeFlag(key, value);
    set(value);
  };

  return (
    <div className="flex flex-col px-2 py-1 border-b bg-background select-none">
      <div className="flex items-stretch gap-2">
        <div className="flex-1 min-w-0">
          <div
            ref={trackRef}
            className="relative h-10 flex items-end gap-px cursor-crosshair"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const at = timeAt(event.clientX);
              setDrag({ from: at, to: at, startX: event.clientX });
            }}
            onPointerMove={(event) => {
              setHover(timeAt(event.clientX));
              setHoverOnTrack(true);
              if (drag) setDrag({ ...drag, to: timeAt(event.clientX) });
            }}
            onPointerLeave={() => {
              setHover(null);
              setHoverOnTrack(false);
            }}
            onPointerUp={(event) => {
              if (!drag) return;
              if (Math.abs(event.clientX - drag.startX) < CLICK_SLOP_PX) {
                onJumpToTime?.(drag.from);
              } else {
                setTimeRange({
                  from: Math.min(drag.from, drag.to),
                  to: Math.max(drag.from, drag.to)
                });
              }
              setDrag(null);
            }}
            onDoubleClick={() => setTimeRange(null)}
          >
            {model.buckets.map((bucket, index) => {
              const volume = bucket.total === 0 ? 0 : Math.sqrt(bucket.total / model.peakVolume);
              const distinct = model.distinct(bucket);
              const height =
                distinct === 0 ? 0 : Math.max(10, Math.sqrt(distinct / model.peakDistinct) * 100);
              const fresh = Math.min(distinct, bucket.newTemplates.length);
              return (
                <div key={index} className="relative flex-1 h-full min-w-0">
                  {volume > 0 && (
                    <div
                      className="absolute bottom-0 inset-x-0 bg-muted-foreground/15 rounded-t-[1px]"
                      style={{ height: `${Math.max(6, volume * 100)}%` }}
                    />
                  )}
                  {distinct > 0 && (
                    <div
                      className="absolute bottom-0 inset-x-0 flex flex-col rounded-t-[1px] overflow-hidden"
                      style={{ height: `${height}%` }}
                    >
                      {fresh > 0 && (
                        <div
                          className={cn(
                            "w-full shrink-0",
                            bucket.errorTemplates.size > 0 ? "bg-red-700" : "bg-amber-700"
                          )}
                          style={{ height: `${(fresh / distinct) * 100}%` }}
                        />
                      )}
                      <div
                        className={cn(
                          "w-full flex-1",
                          bucket.errorTemplates.size > 0 ? "bg-red-500/80" : "bg-amber-500/70"
                        )}
                      />
                    </div>
                  )}
                </div>
              );
            })}

            <BootOverlay sessions={sessions} scale={scale} />
            <GapOverlay scale={scale} />

            {model.ticks.map(({ at, x }) => (
              <div
                key={`tick-${at}`}
                className="absolute inset-y-0 border-l border-foreground/10 pointer-events-none"
                style={{ left: `${x}%` }}
              />
            ))}

            {viewport && viewport.to >= model.min && viewport.from <= model.max && (
              <ViewportBand viewport={viewport} scale={scale} />
            )}

            {hoverBucket && hover !== null && hoverOnTrack && !drag && (
              <div
                className={cn(
                  "absolute top-full mt-1 z-30 w-72 rounded-md border bg-popover text-popover-foreground shadow-md p-2 text-[11px] pointer-events-none",
                  scale.toX(hover) > 70 && "-translate-x-full"
                )}
                style={{ left: `${scale.toX(hover)}%` }}
              >
                <div className="font-medium tabular-nums">
                  {formatMoment(hoverBucket.from, model.multiDay)} –{" "}
                  {formatMoment(hoverBucket.to, model.multiDay)}
                </div>
                <div className="tabular-nums text-muted-foreground">
                  {hoverBucket.bucket.total.toLocaleString()} lines
                  {hoverBucket.bucket.errors > 0 && (
                    <span className="text-red-500">
                      {" "}
                      · {hoverBucket.bucket.errors} errors of{" "}
                      {hoverBucket.bucket.errorTemplates.size} kinds
                    </span>
                  )}
                  {hoverBucket.bucket.warnings > 0 && (
                    <span className="text-amber-600">
                      {" "}
                      · {hoverBucket.bucket.warnings} warnings
                    </span>
                  )}
                  {hoverBucket.hits > 0 && (
                    <span className="text-yellow-600"> · {hoverBucket.hits} search hits</span>
                  )}
                </div>
                {hoverBucket.bucket.newTemplates.length > 0 && (
                  <div className="mt-1">
                    <div className="text-[10px] font-semibold">
                      First seen here ({hoverBucket.bucket.newTemplates.length})
                    </div>
                    {hoverBucket.bucket.newTemplates.slice(0, 3).map((template) => (
                      <div key={template} className="font-mono text-[10px] truncate">
                        {template.replace(/^(ERROR|WARN):/, "")}
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-1">
                  {hoverBucket.topSections.map(([key, count]) => (
                    <div key={key} className="flex gap-2 font-mono text-[10px]">
                      <span className="truncate flex-1">{sectionNameOf(key)}</span>
                      <span className="tabular-nums text-muted-foreground">{count}</span>
                    </div>
                  ))}
                </div>
                {hoverBucket.events.map((event) => (
                  <div key={`${event.ts}-${event.label}`} className="text-[10px] font-medium">
                    {formatClock(event.ts)} {event.label}
                  </div>
                ))}
                <div className="text-[10px] text-muted-foreground/70 mt-1">
                  click to jump · drag to zoom · double-click to reset
                </div>
              </div>
            )}

            {drag && (
              <div
                className="absolute inset-y-0 bg-primary/15 border-x border-primary/70 pointer-events-none"
                style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }}
              />
            )}

            {selectedTime !== null && inRange(selectedTime) && (
              <div
                className="absolute -inset-y-0.5 w-px bg-sky-500 pointer-events-none"
                style={{ left: `${scale.toX(selectedTime)}%` }}
              >
                <div className="absolute -top-0.5 -left-0.75 size-1.5 rounded-full bg-sky-500 ring-2 ring-background" />
              </div>
            )}
          </div>

          {/* What you are looking for: search hits as yellow ticks, Claude's
              marks and bookmarks as pins. */}
          {(hitCells || marks.length > 0) && (
            <div className="relative h-2.5 mt-px">
              {hitCells?.cells.map((count, index) =>
                count === 0 ? null : (
                  <div
                    key={index}
                    role="button"
                    className="absolute bottom-0 bg-yellow-500 rounded-[1px] cursor-pointer hover:bg-yellow-600"
                    style={{
                      left: `${(index / BUCKET_COUNT) * 100}%`,
                      width: `${Math.max(0.35, 100 / BUCKET_COUNT - 0.15)}%`,
                      height: `${30 + 70 * Math.sqrt(count / hitCells.peak)}%`
                    }}
                    title={`${count} search hit${count === 1 ? "" : "s"}`}
                    onClick={() => onJumpToHit?.(scale.fromX(((index + 0.5) / BUCKET_COUNT) * 100))}
                  />
                )
              )}
              {marks
                .filter((mark) => inRange(mark.ts))
                .map((mark, index) => (
                  <div
                    key={`${mark.kind}-${mark.ts}-${index}`}
                    role="button"
                    className={cn(
                      "absolute top-0 size-2 -translate-x-1/2 rounded-full ring-1 ring-background cursor-pointer hover:scale-125 transition-transform",
                      MARK_COLOR[mark.kind]
                    )}
                    style={{ left: `${scale.toX(mark.ts)}%` }}
                    title={`${formatMoment(mark.ts, model.multiDay)} — ${mark.kind}: ${mark.label}`}
                    onClick={mark.onSelect}
                  />
                ))}
            </div>
          )}

          {resource && (
            <ResourceLane series={resource} scale={scale} min={model.min} max={model.max} />
          )}

          {clusters.length > 0 && (
            <div className="relative h-3.5">
              {clusters.map((cluster) => (
                <EventMarker
                  key={`${cluster.x}-${cluster.lead.label}`}
                  cluster={cluster}
                  multiDay={model.multiDay}
                  onSelectEvent={onSelectEvent}
                />
              ))}
            </div>
          )}

          <div className="relative h-3 text-[10px] text-muted-foreground tabular-nums leading-none">
            {model.ticks.map(({ at, x, step }) => (
              <span
                key={at}
                className={cn(
                  "absolute top-0.5",
                  x > 94 ? "-translate-x-full" : "-translate-x-1/2"
                )}
                style={{ left: `${x}%` }}
              >
                {formatTick(at, step)}
              </span>
            ))}
            {hover !== null && (
              <span
                className="absolute top-0.5 -translate-x-1/2 bg-background text-foreground font-medium px-0.5 rounded-sm"
                style={{ left: `${scale.toX(hover)}%` }}
              >
                {formatMoment(hover, model.multiDay)}
              </span>
            )}
          </div>
        </div>

        <div className="w-36 shrink-0 flex flex-col justify-center text-[10px] leading-tight gap-0.5">
          <div className="text-foreground font-medium tabular-nums">
            {formatSpan(model.max - model.min)}
            {model.isZoomed && (
              <span className="text-muted-foreground font-normal">
                {" "}
                of {formatSpan(model.extentSpan)}
              </span>
            )}
          </div>

          {model.isZoomed ? (
            <button
              type="button"
              className="text-primary hover:underline inline-flex items-center gap-0.5 w-fit"
              onClick={() => setTimeRange(null)}
            >
              <X className="size-2.5" />
              show everything
            </button>
          ) : (
            <div className="text-muted-foreground/60 tabular-nums">
              {model.multiDay ? "UTC" : `${formatDate(model.min)} UTC`}
            </div>
          )}

          <div
            className="inline-flex items-center gap-1 text-muted-foreground/70"
            title="Bar height counts distinct error and warning shapes, not lines; the dark cap is shapes seen there for the first time"
          >
            <span className="w-1.5 h-2 bg-red-500" />
            error kinds
            <span className="w-1.5 h-2 bg-red-700 ml-1" />
            new
          </div>

          {(scale.gaps.length > 0 || !compress) && (
            <button
              type="button"
              onClick={() => toggle(COMPRESS_STORAGE_KEY, !compress, setCompress)}
              className="text-primary hover:underline w-fit text-left"
            >
              {compress ? `${scale.gaps.length} quiet gaps cut · show` : "cut quiet gaps"}
            </button>
          )}

          {model.lanes.length > 1 && (
            <button
              type="button"
              onClick={() => toggle(LANES_STORAGE_KEY, !showLanes, setShowLanes)}
              className="text-primary hover:underline inline-flex items-center gap-0.5 w-fit"
            >
              {showLanes ? (
                <ChevronDown className="size-2.5" />
              ) : (
                <ChevronRight className="size-2.5" />
              )}
              {showLanes
                ? "hide sections"
                : model.pinnedLanes
                  ? `pinned sections (${model.lanes.length})`
                  : `noisiest sections (${model.lanes.length})`}
            </button>
          )}
        </div>
      </div>

      {showLanes && model.lanes.length > 1 && (
        <TimelineLanes
          lanes={model.lanes}
          errorPeak={model.laneErrorPeak}
          scale={scale}
          multiDay={model.multiDay}
          sessions={sessions}
          onHover={setHover}
          onJumpToTime={onJumpToTime}
        />
      )}
    </div>
  );
};

const EventIcon = ({ event }: { event: TimelineEvent }) => (
  <span
    className={cn(
      "size-1.5 shrink-0",
      event.kind === "problem" ? "rotate-45" : "rounded-full",
      EVENT_COLOR[event.severity]
    )}
  />
);

/**
 * One event jumps straight to its line. Several that sat too close to draw
 * apart open a list instead, since picking one from a hover tooltip was not
 * possible.
 */
const EventMarker = ({
  cluster,
  multiDay,
  onSelectEvent
}: {
  cluster: EventCluster;
  multiDay: boolean;
  onSelectEvent?: (event: TimelineEvent) => void;
}) => {
  const [open, setOpen] = useState(false);
  const anchorRight = cluster.x > 82;
  const single = cluster.events.length === 1;

  const marker = (
    <div
      role="button"
      onClick={single ? () => onSelectEvent?.(cluster.lead) : undefined}
      className={cn(
        "absolute top-0 flex items-center gap-0.5 cursor-pointer hover:opacity-70",
        open && "opacity-70"
      )}
      style={
        anchorRight
          ? { right: `${100 - cluster.x}%`, flexDirection: "row-reverse" }
          : { left: `${cluster.x}%` }
      }
      title={
        single
          ? `${formatMoment(cluster.lead.ts, multiDay)} — ${cluster.lead.label}`
          : `${cluster.events.length} events — click to list them`
      }
    >
      <EventIcon event={cluster.lead} />
      {!single && (
        <span className="text-[8px] leading-none tabular-nums rounded-sm bg-muted px-0.5 text-foreground">
          {cluster.events.length}
        </span>
      )}
      {cluster.showLabel && (
        <span
          className={cn(
            "text-[9px] leading-none whitespace-nowrap",
            cluster.lead.kind === "problem"
              ? "text-foreground font-medium"
              : "text-muted-foreground"
          )}
        >
          {cluster.lead.label}
        </span>
      )}
    </div>
  );

  if (single) return marker;

  const events = [...cluster.events].sort((a, b) => a.ts - b.ts);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{marker}</PopoverTrigger>
      <PopoverContent align={anchorRight ? "end" : "start"} className="w-80 p-1">
        <div className="px-1.5 py-1 text-[10px] text-muted-foreground tabular-nums">
          {events.length} events · {formatMoment(events[0].ts, multiDay)} –{" "}
          {formatMoment(events[events.length - 1].ts, multiDay)}
        </div>
        <div className="max-h-64 overflow-y-auto">
          {events.map((event, index) => (
            <button
              key={`${event.ts}-${event.label}-${index}`}
              type="button"
              onClick={() => {
                setOpen(false);
                onSelectEvent?.(event);
              }}
              className="w-full flex items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted transition-colors min-w-0"
            >
              <EventIcon event={event} />
              <span className="tabular-nums text-muted-foreground shrink-0">
                {formatClock(event.ts)}
              </span>
              <span
                className={cn("truncate min-w-0", event.kind === "problem" && "font-medium")}
                title={event.log?.message ?? event.label}
              >
                {event.label}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const ViewportBand = ({
  viewport,
  scale
}: {
  viewport: { from: number; to: number };
  scale: TimeScale;
}) => {
  const left = scale.toX(Math.max(scale.min, viewport.from));
  const right = scale.toX(Math.min(scale.max, viewport.to));
  return (
    <div
      className="absolute inset-y-0 bg-sky-500/10 border-x border-sky-500/60 pointer-events-none"
      style={{ left: `${left}%`, width: `${Math.max(0.3, right - left)}%` }}
      title="On screen in the log"
    />
  );
};

/** Squeezed stretches with no log, hatched and labelled with what was cut. */
const GapOverlay = ({ scale }: { scale: TimeScale }) => (
  <>
    {scale.gaps.map((gap) => (
      <div
        key={gap.from}
        className="absolute inset-y-0 flex items-center justify-center overflow-visible bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--border)_3px_4px)]"
        style={{ left: `${gap.x0}%`, width: `${gap.x1 - gap.x0}%` }}
        title={`No log for ${formatSpan(gap.to - gap.from)} (${formatClock(gap.from)} → ${formatClock(gap.to)})`}
      >
        <span className="text-[8px] leading-none text-muted-foreground bg-background/90 rounded-sm px-px whitespace-nowrap pointer-events-none">
          {formatSpan(gap.to - gap.from)}
        </span>
      </div>
    ))}
  </>
);

/**
 * Every other boot is shaded so their extents read at a glance; an unclean end
 * gets a red line where the next boot cut in.
 */
const BootOverlay = ({ sessions, scale }: { sessions: BootSession[]; scale: TimeScale }) => (
  <>
    {sessions
      .filter((session) => session.endTs >= scale.min && session.startTs <= scale.max)
      .map((session) => {
        const left = scale.toX(Math.max(scale.min, session.startTs));
        const right = scale.toX(Math.min(scale.max, session.endTs));
        return (
          <div key={session.index} className="contents">
            {session.index % 2 === 1 && (
              <div
                className="absolute inset-y-0 bg-foreground/[0.05] pointer-events-none"
                style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }}
              />
            )}
            {session.ending === "unclean" && right < 100 && (
              <div
                className="absolute inset-y-0 border-l-2 border-red-500/70 pointer-events-none"
                style={{ left: `${right}%` }}
                title={`Boot ${session.index + 1} ended without a shutdown`}
              />
            )}
          </div>
        );
      })}
  </>
);

/**
 * vmlog's CPU usage as a line and swap traffic as bars, on the strip's own
 * clock, so "swap spiked, then errors started" reads off one picture.
 */
const ResourceLane = memo(function ResourceLane({
  series,
  scale,
  min,
  max
}: {
  series: SamplerSeries;
  scale: TimeScale;
  min: number;
  max: number;
}) {
  const shapes = useMemo(() => {
    const rows = series.rows.filter((row) => row.ts >= min && row.ts <= max);
    if (rows.length < 2) return null;
    const swapOf = (row: SamplerSeries["rows"][number]) =>
      (row.values.pswpin ?? 0) + (row.values.pswpout ?? 0);
    const swapPeak = Math.max(1, ...rows.map(swapOf));
    const hasCpu = rows.some((row) => typeof row.values.cpuusage === "number");
    const cpu = hasCpu
      ? rows
          .map((row, index) => {
            const y = 10 - Math.min(1, Math.max(0, row.values.cpuusage ?? 0)) * 9.5;
            return `${index === 0 ? "M" : "L"}${scale.toX(row.ts).toFixed(2)},${y.toFixed(2)}`;
          })
          .join(" ")
      : "";
    const swap = rows
      .filter((row) => swapOf(row) > 0)
      .map((row) => ({ x: scale.toX(row.ts), height: (swapOf(row) / swapPeak) * 10 }));
    return { cpu, swap, swapPeak };
  }, [series, scale, min, max]);

  if (!shapes) return null;

  return (
    <div
      className="relative h-4 mt-px"
      title={`vmlog: CPU usage (line), swap pages in+out (purple, peak ${shapes.swapPeak})`}
    >
      <svg
        viewBox="0 0 100 10"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
      >
        {shapes.swap.map((bar, index) => (
          <rect
            key={index}
            x={bar.x - 0.15}
            y={10 - bar.height}
            width={0.3}
            height={bar.height}
            className="fill-violet-500/70"
          />
        ))}
        {shapes.cpu && (
          <path
            d={shapes.cpu}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            className="text-sky-600/80"
          />
        )}
      </svg>
      <span className="absolute left-0 top-0 text-[8px] leading-none text-muted-foreground bg-background/80 rounded-sm px-0.5">
        cpu · swap
      </span>
    </div>
  );
});

const LANE_LABEL_WIDTH = "w-36";

/**
 * Cells are shaded by how busy the section was relative to its own peak, and
 * turn red by its errors relative to the busiest error cell anywhere, so a
 * quiet section's activity stays visible and errors stay comparable.
 */
const TimelineLanes = memo(function TimelineLanes({
  lanes,
  errorPeak,
  scale,
  multiDay,
  sessions,
  onHover,
  onJumpToTime
}: {
  lanes: Lane[];
  errorPeak: number;
  scale: TimeScale;
  multiDay: boolean;
  sessions: BootSession[];
  onHover: (ts: number | null) => void;
  onJumpToTime?: (ts: number, section?: string) => void;
}) {
  const timeAt = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return scale.fromX(
      Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100))
    );
  };

  return (
    <div className="flex flex-col gap-px mt-1 pt-1 border-t border-dashed">
      {lanes.map((lane) => (
        <div key={lane.key} className="flex items-center gap-2 h-3">
          <div
            className="relative flex-1 min-w-0 h-full flex gap-px cursor-pointer"
            onMouseMove={(event) => onHover(timeAt(event))}
            onMouseLeave={() => onHover(null)}
            onClick={(event) => onJumpToTime?.(timeAt(event), lane.key)}
          >
            {lane.cells.map((cell, index) => (
              <div
                key={index}
                className={cn(
                  "flex-1 min-w-0 rounded-[1px]",
                  cell.errors > 0
                    ? "bg-red-500"
                    : cell.warnings > 0
                      ? "bg-amber-500"
                      : "bg-muted-foreground"
                )}
                style={{
                  opacity:
                    cell.total === 0
                      ? 0.05
                      : cell.errors > 0
                        ? 0.3 + 0.7 * Math.sqrt(cell.errors / errorPeak)
                        : 0.12 + 0.4 * Math.sqrt(cell.total / lane.peak)
                }}
                title={
                  cell.total === 0
                    ? undefined
                    : `${sectionNameOf(lane.key)} · ${formatMoment(scale.fromX((index / BUCKET_COUNT) * 100), multiDay)}: ${cell.total} lines${cell.errors ? `, ${cell.errors} errors` : ""}${cell.warnings ? `, ${cell.warnings} warnings` : ""}`
                }
              />
            ))}
            <BootOverlay sessions={sessions} scale={scale} />
            <GapOverlay scale={scale} />
          </div>
          <div
            className={cn(
              LANE_LABEL_WIDTH,
              "shrink-0 flex items-baseline gap-1 text-[10px] leading-none min-w-0"
            )}
            title={sectionNameOf(lane.key)}
          >
            <span className="truncate font-mono">{sectionNameOf(lane.key)}</span>
            {lane.errors > 0 && <span className="text-red-500 tabular-nums">{lane.errors}</span>}
            <span className="ml-auto text-muted-foreground tabular-nums">
              {lane.total.toLocaleString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
});
