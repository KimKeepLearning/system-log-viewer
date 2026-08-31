import { useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { X } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { selectedTimeAtom, timeRangeAtom } from "@renderer/lib/atom";
import { TimelineEvent } from "@renderer/lib/log-analysis";
import { ExtendedLog } from "../types";

const BUCKET_COUNT = 160;

interface Bucket {
  total: number;
  errors: number;
  warnings: number;
}

const MICROS_PER_DAY = 86_400 * 1_000_000;

const formatClock = (micros: number): string => new Date(micros / 1000).toISOString().slice(11, 19);

const formatDate = (micros: number): string => new Date(micros / 1000).toISOString().slice(0, 10);

const formatDayMonth = (micros: number): string =>
  new Date(micros / 1000).toISOString().slice(5, 10);

// Times alone are ambiguous once a log crosses midnight, and these often do:
// a feedback archive can hold a companion service log from ten days earlier.
const formatMoment = (micros: number, multiDay: boolean): string =>
  multiDay ? `${formatDayMonth(micros)} ${formatClock(micros)}` : formatClock(micros);

const formatSpan = (micros: number): string => {
  const seconds = micros / 1_000_000;
  if (seconds < 90) return `${seconds.toFixed(1)}s`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)}min`;
  if (seconds < 2 * 86_400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86_400).toFixed(1)} days`;
};

/** UTC midnights inside the range, so day changes are visible on the strip. */
const dayBoundaries = (min: number, max: number): number[] => {
  const first = new Date(min / 1000);
  let at = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate() + 1) * 1000;

  const ticks: number[] = [];
  // A multi-year log would otherwise draw hundreds of lines; past this many the
  // boundaries stop carrying information anyway.
  while (at <= max && ticks.length < 400) {
    ticks.push(at);
    at += MICROS_PER_DAY;
  }
  return ticks;
};

const EVENT_COLOR: Record<TimelineEvent["severity"], string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-sky-500"
};

/**
 * An incident usually shows up as a spike in how much the machine had to say,
 * so plotting volume over time turns "when did this happen" into something you
 * can see rather than scroll for. Dragging across it narrows the log to that
 * window and rescales the strip to it.
 */
export const TimelineStrip = ({
  logs,
  events = []
}: {
  logs: ExtendedLog[];
  events?: TimelineEvent[];
}) => {
  const [timeRange, setTimeRange] = useAtom(timeRangeAtom);
  const selectedTime = useAtomValue(selectedTimeAtom);
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  // Counts come from the unfiltered set, so the shape does not move while you
  // narrow it; a histogram that redraws on every click is impossible to aim at.
  const model = useMemo(() => {
    let extentMin = Infinity;
    let extentMax = -Infinity;
    for (const log of logs) {
      if (typeof log.ts !== "number") continue;
      if (log.ts < extentMin) extentMin = log.ts;
      if (log.ts > extentMax) extentMax = log.ts;
    }
    if (extentMin === Infinity || extentMax <= extentMin) return null;

    // An explicit window becomes the strip's own range, so dragging zooms as
    // well as filters. Feedback archives routinely hold a companion service log
    // reaching back weeks, which would otherwise squeeze the dump everyone
    // actually came for into a pixel at the right edge.
    const min = timeRange ? Math.max(extentMin, timeRange.from) : extentMin;
    const max = timeRange ? Math.min(extentMax, timeRange.to) : extentMax;
    const span = max - min;
    if (span <= 0) return null;

    const buckets: Bucket[] = Array.from({ length: BUCKET_COUNT }, () => ({
      total: 0,
      errors: 0,
      warnings: 0
    }));

    for (const log of logs) {
      if (typeof log.ts !== "number" || log.ts < min || log.ts > max) continue;
      const index = Math.min(BUCKET_COUNT - 1, Math.floor(((log.ts - min) / span) * BUCKET_COUNT));
      const bucket = buckets[index];
      bucket.total++;
      if (log.level === "ERROR") bucket.errors++;
      else if (log.level === "WARN") bucket.warnings++;
    }

    const days = dayBoundaries(min, max);
    const peak = Math.max(...buckets.map((bucket) => bucket.total));
    return {
      min,
      max,
      span,
      buckets,
      peak: peak === 0 ? 1 : peak,
      days,
      multiDay: days.length > 0,
      // Label every nth boundary so the dates stay readable on a long log.
      labelEvery: Math.max(1, Math.ceil(days.length / 8)),
      isZoomed: timeRange !== null,
      extentSpan: extentMax - extentMin
    };
  }, [logs, timeRange]);

  if (!model) return null;

  const timeAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return model.min;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return model.min + ratio * model.span;
  };

  const ratioOf = (micros: number) => ((micros - model.min) / model.span) * 100;

  // Labels are dropped where they would collide with the previous one, so a
  // burst of events stays readable as marks without a wall of overlapping text.
  const LABEL_GAP_PERCENT = 9;
  let lastLabelAt = -Infinity;
  const placedEvents = events
    .map((event) => ({ event, left: ratioOf(event.ts) }))
    .filter(({ left }) => left >= 0 && left <= 100)
    .map(({ event, left }) => {
      const showLabel = left - lastLabelAt > LABEL_GAP_PERCENT;
      if (showLabel) lastLabelAt = left;
      return { event, left, showLabel, anchorRight: left > 82 };
    });

  // Only the in-progress drag is drawn: once released, the window becomes the
  // strip's range, so an overlay would just cover the whole track.
  const selectionLeft = drag ? ratioOf(Math.min(drag.from, drag.to)) : 0;
  const selectionWidth = drag
    ? Math.max(0.4, ratioOf(Math.max(drag.from, drag.to)) - selectionLeft)
    : 0;

  return (
    <div className="flex items-stretch gap-2 px-2 py-1 border-b bg-background select-none">
      <div className="flex-1 min-w-0">
        <div
          ref={trackRef}
          className="relative h-9 flex items-end gap-px cursor-crosshair"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const at = timeAt(event.clientX);
            setDrag({ from: at, to: at });
          }}
          onPointerMove={(event) => {
            setHover(timeAt(event.clientX));
            if (drag) setDrag({ ...drag, to: timeAt(event.clientX) });
          }}
          onPointerLeave={() => setHover(null)}
          onPointerUp={() => {
            if (!drag) return;
            const from = Math.min(drag.from, drag.to);
            const to = Math.max(drag.from, drag.to);
            // A plain click is a clear, not a zero-width window nothing matches.
            setTimeRange(to - from < model.span / 500 ? null : { from, to });
            setDrag(null);
          }}
        >
          {model.buckets.map((bucket, index) => {
            const height = bucket.total === 0 ? 0 : Math.max(8, (bucket.total / model.peak) * 100);
            return (
              <div key={index} className="flex-1 h-full flex flex-col justify-end min-w-0">
                <div
                  className="w-full flex flex-col-reverse rounded-t-[1px] overflow-hidden"
                  style={{ height: `${height}%` }}
                >
                  <div className="w-full flex-1 bg-muted-foreground/25" />
                  {bucket.warnings > 0 && (
                    <div
                      className="w-full bg-amber-500/80 shrink-0"
                      style={{ height: `${(bucket.warnings / bucket.total) * 100}%` }}
                    />
                  )}
                  {bucket.errors > 0 && (
                    <div
                      className="w-full bg-red-500 shrink-0"
                      style={{ height: `${(bucket.errors / bucket.total) * 100}%` }}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {/* Midnights, so a log that runs across days does not read as one. */}
          {model.days.map((at, index) => (
            <div
              key={at}
              className="absolute inset-y-0 border-l border-dashed border-foreground/25 pointer-events-none"
              style={{ left: `${ratioOf(at)}%` }}
            >
              {index % model.labelEvery === 0 && (
                <span className="absolute top-0 left-1 text-[9px] leading-none text-muted-foreground bg-background/80 px-0.5 rounded-sm tabular-nums">
                  {formatDayMonth(at)}
                </span>
              )}
            </div>
          ))}

          {drag && (
            <div
              className="absolute inset-y-0 bg-primary/15 border-x border-primary/70 pointer-events-none"
              style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }}
            />
          )}

          {/* Where the selected line sits in the session. */}
          {selectedTime !== null && selectedTime >= model.min && selectedTime <= model.max && (
            <div
              className="absolute -inset-y-0.5 w-px bg-sky-500 pointer-events-none"
              style={{ left: `${ratioOf(selectedTime)}%` }}
            >
              <div className="absolute -top-0.5 -left-0.75 size-1.5 rounded-full bg-sky-500 ring-2 ring-background" />
            </div>
          )}
        </div>

        {/* Events get their own lane with their names written out, so the marks
            do not need to be decoded from a key. */}
        {placedEvents.length > 0 && (
          <div className="relative h-3.5">
            {placedEvents.map(({ event, left, showLabel, anchorRight }) => (
              <div
                key={`${event.ts}-${event.label}`}
                className="absolute top-0 flex items-center gap-0.5"
                style={
                  anchorRight
                    ? { right: `${100 - left}%`, flexDirection: "row-reverse" }
                    : { left: `${left}%` }
                }
                title={`${formatMoment(event.ts, model.multiDay)} — ${event.label}`}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0",
                    event.kind === "problem" ? "rotate-45" : "rounded-full",
                    EVENT_COLOR[event.severity]
                  )}
                />
                {showLabel && (
                  <span
                    className={cn(
                      "text-[9px] leading-none whitespace-nowrap",
                      event.kind === "problem"
                        ? "text-foreground font-medium"
                        : "text-muted-foreground"
                    )}
                  >
                    {event.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums leading-tight">
          <span>{formatMoment(model.min, model.multiDay)}</span>
          <span className={cn(hover === null && "opacity-0")}>
            {hover !== null && formatMoment(hover, model.multiDay)}
          </span>
          <span>{formatMoment(model.max, model.multiDay)}</span>
        </div>
      </div>

      <div className="w-36 shrink-0 flex flex-col justify-center text-[10px] leading-tight">
        <div className="text-foreground font-medium tabular-nums">
          {formatSpan(model.span)}
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
          // On a single-day log the date appears nowhere else on screen.
          <div className="text-muted-foreground/60 tabular-nums">
            {model.multiDay ? "UTC · drag to zoom" : `${formatDate(model.min)} UTC`}
          </div>
        )}

        {placedEvents.length > 0 && (
          <div className="flex items-center gap-2 mt-0.5 text-muted-foreground/70">
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rotate-45 bg-red-500" />
              problem
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-sky-500" />
              state
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
