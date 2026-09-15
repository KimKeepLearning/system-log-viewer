import { describe, expect, it } from "vitest";
import { deriveBootAnchor, monotonicSecondsToMicros, parseWallTimestamp } from "../log-time";
import { SYSLOG_SAMPLE } from "./fixtures";

describe("parseWallTimestamp", () => {
  it("keeps microsecond resolution", () => {
    expect(parseWallTimestamp("2026-08-31T06:17:23.867672Z")).toBe(
      Date.parse("2026-08-31T06:17:23Z") * 1000 + 867672
    );
  });

  it("applies a zone offset", () => {
    expect(parseWallTimestamp("2026-08-30T23:17:31.303993-07:00")).toBe(
      Date.parse("2026-08-31T06:17:31Z") * 1000 + 303993
    );
  });

  it("reads a missing zone as UTC, so the file does not shift with the reader", () => {
    expect(parseWallTimestamp("2026-08-21 23:16:25.285")).toBe(
      Date.parse("2026-08-21T23:16:25Z") * 1000 + 285000
    );
  });

  it("accepts nanosecond fractions", () => {
    expect(parseWallTimestamp("2026-01-15T17:11:47.912820765")).toBe(
      Date.parse("2026-01-15T17:11:47Z") * 1000 + 912821
    );
  });

  it.each(["chronos", "12.345", "", "2026-08-31", "not a time at all"])("rejects %s", (raw) => {
    expect(parseWallTimestamp(raw)).toBeNull();
  });
});

describe("monotonicSecondsToMicros", () => {
  it("converts seconds since boot", () => {
    expect(monotonicSecondsToMicros("0.606417")).toBe(606417);
    expect(monotonicSecondsToMicros("12.345678")).toBe(12_345_678);
  });
});

describe("deriveBootAnchor", () => {
  it("pins monotonic zero to the wall clock", () => {
    const anchor = deriveBootAnchor(SYSLOG_SAMPLE);

    expect(anchor).not.toBeNull();
    expect(anchor!.sampleCount).toBe(12);
    expect(anchor!.bootEpochUs).toBe(Date.parse("2026-08-31T06:17:50Z") * 1000);
  });

  it("ignores a late straggler rather than dragging the estimate with it", () => {
    const withOutlier = `${SYSLOG_SAMPLE}\n2026-08-31T06:20:00.000000Z INFO kernel: [   30.000000] relayed late`;

    expect(deriveBootAnchor(withOutlier)!.bootEpochUs).toBe(
      Date.parse("2026-08-31T06:17:50Z") * 1000
    );
  });

  it("returns null when the section relays no kernel lines", () => {
    expect(deriveBootAnchor("2026-08-31T06:18:10.000000Z INFO chrome[1]: hello")).toBeNull();
  });
});
