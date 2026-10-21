import type { TimelineEvent } from "./log-analysis";

/**
 * Where a moment sits on the strip, in percent of its width. Stretches with no
 * log at all -- the device off, asleep, or a companion log from weeks earlier --
 * are squeezed to a fixed sliver, so the minutes that hold the evidence get the
 * width instead of an even share of empty time.
 */
export interface ScaleSegment {
  from: number;
  to: number;
  x0: number;
  x1: number;
  gap: boolean;
}

export interface TimeScale {
  min: number;
  max: number;
  segments: ScaleSegment[];
  gaps: ScaleSegment[];
  /** Time that is drawn at full scale, i.e. not inside a gap. */
  activeSpan: number;
  toX: (ts: number) => number;
  fromX: (x: number) => number;
}

const MIN_GAP_US = 60 * 1_000_000;
// A gap must also be a real share of the range, or a quiet minute in a short
// log would be cut out of it.
const GAP_SHARE = 1 / 25;
const GAP_WIDTH_PERCENT = 2;
const MAX_GAPS = 12;

const linear = (segments: ScaleSegment[], ts: number): number => {
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (segments[mid].from <= ts) low = mid;
    else high = mid - 1;
  }
  const segment = segments[low];
  const width = segment.to - segment.from;
  const ratio = width <= 0 ? 0 : Math.min(1, Math.max(0, (ts - segment.from) / width));
  return segment.x0 + ratio * (segment.x1 - segment.x0);
};

export const buildScale = (
  sortedTs: ArrayLike<number>,
  min: number,
  max: number,
  compress: boolean
): TimeScale => {
  const span = max - min;
  const threshold = Math.max(MIN_GAP_US, span * GAP_SHARE);
  let gaps: { from: number; to: number }[] = [];

  if (compress) {
    let previous: number | null = null;
    for (let i = 0; i < sortedTs.length; i++) {
      const ts = sortedTs[i];
      if (ts < min || ts > max) continue;
      if (previous !== null && ts - previous > threshold) gaps.push({ from: previous, to: ts });
      previous = ts;
    }
    gaps = gaps
      .sort((a, b) => b.to - b.from - (a.to - a.from))
      .slice(0, MAX_GAPS)
      .sort((a, b) => a.from - b.from);
  }

  const gapTime = gaps.reduce((sum, gap) => sum + gap.to - gap.from, 0);
  const activeSpan = Math.max(1, span - gapTime);
  const activeWidth = 100 - gaps.length * GAP_WIDTH_PERCENT;

  const segments: ScaleSegment[] = [];
  let x = 0;
  let cursor = min;
  for (const gap of gaps) {
    const width = ((gap.from - cursor) / activeSpan) * activeWidth;
    segments.push({ from: cursor, to: gap.from, x0: x, x1: x + width, gap: false });
    x += width;
    segments.push({ from: gap.from, to: gap.to, x0: x, x1: x + GAP_WIDTH_PERCENT, gap: true });
    x += GAP_WIDTH_PERCENT;
    cursor = gap.to;
  }
  segments.push({ from: cursor, to: max, x0: x, x1: 100, gap: false });

  const byX = segments.map((segment) => ({
    from: segment.x0,
    to: segment.x1,
    x0: segment.from,
    x1: segment.to,
    gap: segment.gap
  }));

  return {
    min,
    max,
    segments,
    gaps: segments.filter((segment) => segment.gap),
    activeSpan,
    toX: (ts) => linear(segments, ts),
    fromX: (value) => linear(byX, value)
  };
};

const SECOND = 1_000_000;
const TICK_STEPS = [
  1,
  5,
  15,
  30,
  60,
  300,
  900,
  1800,
  3600,
  3 * 3600,
  6 * 3600,
  12 * 3600,
  86_400,
  7 * 86_400
].map((seconds) => seconds * SECOND);

const MIN_TICK_LABEL_GAP = 7;

/** Round moments over the drawn (non-gap) time, about eight across the strip. */
export const axisTicks = (scale: TimeScale): { at: number; x: number; step: number }[] => {
  const step =
    TICK_STEPS.find((candidate) => scale.activeSpan / candidate <= 8) ?? TICK_STEPS.at(-1)!;
  const ticks: { at: number; x: number; step: number }[] = [];
  let lastX = -Infinity;
  for (const segment of scale.segments) {
    if (segment.gap) continue;
    for (let at = Math.ceil(segment.from / step) * step; at <= segment.to; at += step) {
      const x = scale.toX(at);
      if (x - lastX < MIN_TICK_LABEL_GAP) continue;
      ticks.push({ at, x, step });
      lastX = x;
    }
  }
  return ticks;
};

const priority = (event: TimelineEvent): number => {
  if (event.kind === "problem") return event.severity === "critical" ? 0 : 1;
  if (event.label.startsWith("boot")) return 2;
  return 3;
};

export interface EventCluster {
  x: number;
  events: TimelineEvent[];
  lead: TimelineEvent;
  showLabel: boolean;
}

const CLUSTER_PERCENT = 1.2;
// Roughly what a 9px label costs per character on a strip ~1000px wide.
const PERCENT_PER_CHAR = 0.55;

/**
 * Marks that would overlap become one mark with a count. Labels are handed out
 * by importance rather than position, so a crash keeps its name even when a
 * chatty lifecycle event sits right before it.
 */
export const clusterEvents = (events: TimelineEvent[], scale: TimeScale): EventCluster[] => {
  const placed = events
    .filter((event) => event.ts >= scale.min && event.ts <= scale.max)
    .map((event) => ({ event, x: scale.toX(event.ts) }))
    .sort((a, b) => a.x - b.x);

  const clusters: EventCluster[] = [];
  for (const { event, x } of placed) {
    const last = clusters[clusters.length - 1];
    if (last && x - last.x < CLUSTER_PERCENT) {
      last.events.push(event);
      if (priority(event) < priority(last.lead)) last.lead = event;
    } else {
      clusters.push({ x, events: [event], lead: event, showLabel: false });
    }
  }

  const taken: { from: number; to: number }[] = [];
  for (const cluster of [...clusters].sort((a, b) => priority(a.lead) - priority(b.lead))) {
    const width = (cluster.lead.label.length + 3) * PERCENT_PER_CHAR;
    const from = cluster.x > 82 ? cluster.x - width : cluster.x;
    const to = from + width;
    if (taken.some((span) => from < span.to + 0.5 && to > span.from - 0.5)) continue;
    taken.push({ from, to });
    cluster.showLabel = true;
  }

  return clusters;
};
