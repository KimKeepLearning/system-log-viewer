import { describe, expect, it } from "vitest";
import { axisTicks, buildScale, clusterEvents } from "../timeline";
import type { TimelineEvent } from "../log-analysis";

const S = 1_000_000;
const HOUR = 3600 * S;

describe("buildScale", () => {
  // Ten minutes of log, seven quiet hours, then ten more minutes.
  const timestamps = [
    ...Array.from({ length: 11 }, (_, i) => i * 60 * S),
    ...Array.from({ length: 11 }, (_, i) => 7 * HOUR + i * 60 * S)
  ];
  const min = timestamps[0];
  const max = timestamps[timestamps.length - 1];

  it("squeezes a stretch with no log into a sliver", () => {
    const scale = buildScale(timestamps, min, max, true);

    expect(scale.gaps).toHaveLength(1);
    expect(scale.gaps[0].x1 - scale.gaps[0].x0).toBe(2);
    // Each ten-minute stretch gets half of what is left.
    expect(scale.toX(10 * 60 * S)).toBeCloseTo(49, 5);
    expect(scale.toX(7 * HOUR)).toBeCloseTo(51, 5);
  });

  it("maps back from x to time", () => {
    const scale = buildScale(timestamps, min, max, true);
    for (const ts of [0, 5 * 60 * S, 7 * HOUR + 3 * 60 * S, max]) {
      expect(scale.fromX(scale.toX(ts))).toBeCloseTo(ts, -1);
    }
  });

  it("keeps time linear when compression is off", () => {
    const scale = buildScale(timestamps, min, max, false);

    expect(scale.gaps).toHaveLength(0);
    expect(scale.toX(max / 2)).toBeCloseTo(50, 5);
  });
});

describe("axisTicks", () => {
  it("puts round moments only on drawn time", () => {
    const everyMinute = Array.from({ length: 31 }, (_, i) => i * 60 * S);
    const scale = buildScale(everyMinute, 0, 30 * 60 * S, true);
    const ticks = axisTicks(scale);

    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks.every((tick) => tick.at % (5 * 60 * S) === 0)).toBe(true);
  });
});

describe("clusterEvents", () => {
  const event = (
    ts: number,
    label: string,
    kind: TimelineEvent["kind"],
    severity: TimelineEvent["severity"]
  ): TimelineEvent => ({
    ts,
    label,
    kind,
    severity
  });

  it("folds overlapping marks and lets the crash keep its label", () => {
    const scale = buildScale([0, 1000 * S], 0, 1000 * S, false);
    const clusters = clusterEvents(
      [
        event(100 * S, "idle", "lifecycle", "info"),
        event(105 * S, "chrome SIGSEGV", "problem", "critical"),
        event(500 * S, "resume", "lifecycle", "info")
      ],
      scale
    );

    expect(clusters).toHaveLength(2);
    expect(clusters[0].events).toHaveLength(2);
    expect(clusters[0].lead.label).toBe("chrome SIGSEGV");
    expect(clusters.every((cluster) => cluster.showLabel)).toBe(true);
  });
});
