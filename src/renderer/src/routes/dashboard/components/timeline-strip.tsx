import { useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { X } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { selectedTimeAtom, timeRangeAtom } from "@renderer/lib/atom";
import { ExtendedLog } from "../types";

const BUCKET_COUNT = 160;

interface Bucket {
  total: number;
  errors: number;
  warnings: number;
}

const formatClock = (micros: number): string => new Date(micros / 1000).toISOString().slice(11, 19);

const formatSpan = (micros: number): string => {
  const seconds = micros / 1_000_000;
  if (seconds < 90) return `${seconds.toFixed(1)}s`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)}min`;
  return `${(seconds / 3600).toFixed(1)}h`;
};

/**
 * An incident usually shows up as a spike in how much the machine had to say,
 * so plotting volume over time turns "when did this happen" into something you
 * can see rather than scroll for. Dragging across it narrows the log to that
 * window.
 */
export const TimelineStrip = ({ logs }: { logs: ExtendedLog[] }) => {
  const [timeRange, setTimeRange] = useAtom(timeRangeAtom);
  const selectedTime = useAtomValue(selectedTimeAtom);
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  // Built from the unfiltered set so the shape stays put while you narrow it;
  // a histogram that redraws itself on every click is impossible to aim at.
  const model = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const log of logs) {
      if (typeof log.ts !== "number") continue;
      if (log.ts < min) min = log.ts;
      if (log.ts > max) max = log.ts;
    }
    if (min === Infinity || max <= min) return null;

    const span = max - min;
    const buckets: Bucket[] = Array.from({ length: BUCKET_COUNT }, () => ({
      total: 0,
      errors: 0,
      warnings: 0
    }));

    for (const log of logs) {
      if (typeof log.ts !== "number") continue;
      const index = Math.min(BUCKET_COUNT - 1, Math.floor(((log.ts - min) / span) * BUCKET_COUNT));
      const bucket = buckets[index];
      bucket.total++;
      if (log.level === "ERROR") bucket.errors++;
      else if (log.level === "WARN") bucket.warnings++;
    }

    return { min, max, span, buckets, peak: Math.max(...buckets.map((b) => b.total)) };
  }, [logs]);

  if (!model) return null;

  const timeAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return model.min;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return model.min + ratio * model.span;
  };

  const ratioOf = (micros: number) => ((micros - model.min) / model.span) * 100;

  const selection = drag ?? timeRange;
  const selectionLeft = selection ? ratioOf(Math.min(selection.from, selection.to)) : 0;
  const selectionWidth = selection
    ? Math.max(0.4, ratioOf(Math.max(selection.from, selection.to)) - selectionLeft)
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

          {selection && (
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

        <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums leading-tight">
          <span>{formatClock(model.min)}</span>
          <span className={cn(hover === null && "opacity-0")}>
            {hover !== null && formatClock(hover)}
          </span>
          <span>{formatClock(model.max)}</span>
        </div>
      </div>

      <div className="w-32 shrink-0 flex flex-col justify-center text-[10px] leading-tight">
        {timeRange ? (
          <>
            <div className="text-foreground font-medium tabular-nums">
              {formatClock(timeRange.from)} – {formatClock(timeRange.to)}
            </div>
            <button
              type="button"
              className="text-primary hover:underline inline-flex items-center gap-0.5 w-fit"
              onClick={() => setTimeRange(null)}
            >
              <X className="size-2.5" />
              clear window
            </button>
          </>
        ) : (
          <>
            <div className="text-muted-foreground tabular-nums">spans {formatSpan(model.span)}</div>
            <div className="text-muted-foreground/60">drag to narrow</div>
          </>
        )}
      </div>
    </div>
  );
};
