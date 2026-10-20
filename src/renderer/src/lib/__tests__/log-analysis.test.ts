import { describe, expect, it } from "vitest";
import { detectBootSessions } from "../log-analysis";
import type { AnalyzedLog } from "../log-rules";

const SECOND = 1_000_000;
const T0 = Date.parse("2026-08-31T06:00:00Z") * 1000;

const line = (
  offsetSeconds: number,
  message: string,
  level: AnalyzedLog["level"] = "INFO"
): AnalyzedLog => ({
  ts: T0 + offsetSeconds * SECOND,
  tsKind: "wall",
  level,
  message,
  sourceFile: "system_logs.txt::messages"
});

describe("detectBootSessions", () => {
  it("returns nothing when the log never shows a kernel start", () => {
    expect(detectBootSessions([line(0, "hello"), line(5, "world")])).toEqual([]);
  });

  it("treats the syslog relay of the same boot as one session", () => {
    const sessions = detectBootSessions([
      line(0, "Booting Linux on physical CPU 0x0"),
      line(3.6, "Linux version 6.6.0 (chrome-bot@chromeos)"),
      line(20, "login-prompt-visible")
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].ending).toBe("ongoing");
  });

  it("measures time to login and tells a clean shutdown from a crash", () => {
    const sessions = detectBootSessions([
      line(-30, "left over from before the first boot"),
      line(0, "Booting Linux on physical CPU 0x0"),
      line(12, "bootstat: login-prompt-visible"),
      line(40, "something broke", "ERROR"),
      line(100, "Shutting down for reboot"),
      line(200, "Booting Linux on physical CPU 0x0"),
      line(215, "login-prompt-visible"),
      line(300, "kernel BUG at mm/slub.c", "ERROR"),
      line(500, "Booting Linux on physical CPU 0x0"),
      line(560, "still running")
    ]);

    expect(sessions.map((session) => session.ending)).toEqual(["clean", "unclean", "ongoing"]);
    expect(sessions.map((session) => session.lines)).toEqual([4, 3, 2]);
    expect(sessions.map((session) => session.errors)).toEqual([1, 1, 0]);
    expect(sessions[0].loginPromptTs! - sessions[0].startTs).toBe(12 * SECOND);
    expect(sessions[2].loginPromptTs).toBeNull();
    expect(sessions[1].endTs).toBe(sessions[2].startTs);
    expect(sessions[1].lastTs).toBe(T0 + 300 * SECOND);
    expect(sessions[2].endTs).toBe(T0 + 560 * SECOND);
  });

  it("places lines by time even when sections arrive out of order", () => {
    const sessions = detectBootSessions([
      line(250, "from the second boot"),
      line(0, "Booting Linux on physical CPU 0x0"),
      line(200, "Booting Linux on physical CPU 0x0"),
      line(10, "from the first boot")
    ]);

    expect(sessions.map((session) => session.lines)).toEqual([2, 2]);
  });
});
