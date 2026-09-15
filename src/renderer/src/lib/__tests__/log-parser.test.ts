import { describe, expect, it } from "vitest";
import {
  extractLogSection,
  extractSectionsRawAsync,
  extractSingleLineFields,
  parseAllLogSections,
  parseDeviceInfo,
  parseLogLine,
  parseLogSection
} from "../log-parser";
import { Board } from "../typings/device";
import {
  AUDIT_LINE,
  CHROME_LINES,
  CRAS_LINE,
  DEVICE_EVENT_LINE,
  KERNEL_LINES,
  NON_LOG_LINES,
  SERVICE_LINE,
  SYSTEM_LOGS_SAMPLE
} from "./fixtures";

describe("parseLogLine", () => {
  it("reads a standard chrome line", () => {
    const log = parseLogLine(CHROME_LINES[0]);

    expect(log.tsKind).toBe("wall");
    expect(log.ts).toBe(Date.parse("2026-08-31T06:17:25Z") * 1000 + 92359);
    expect(log.level).toBe("WARN");
    expect(log.process).toBe("chrome[1016:1016]");
    expect(log.source).toBe("../../chrome/browser/ui/views/frame/browser_view.cc:1234");
    expect(log.message).toBe("Widget not ready");
  });

  it("shortens a source path at the chromium src root", () => {
    const log = parseLogLine(
      "2026-08-31T06:17:25.000000Z INFO chrome[1]: [../../third_party/x/src/ui/views/thing.cc:12] hi"
    );

    expect(log.source).toBe("ui/views/thing.cc:12");
  });

  it("splits the subsystem tag off the message", () => {
    const log = parseLogLine(CHROME_LINES[1]);

    expect(log.tag).toBe("AI Subscription");
    expect(log.message).toBe("user belongs to 4 workspaces");
  });

  it.each([
    ["2026-08-31T06:17:25.000000Z ERROR chrome[1]: [a.cc:1] x", "ERROR"],
    ["2026-08-31T06:17:25.000000Z CRIT chrome[1]: [a.cc:1] x", "ERROR"],
    ["2026-08-31T06:17:25.000000Z WARNING chrome[1]: [a.cc:1] x", "WARN"],
    ["2026-08-31T06:17:25.000000Z VERBOSE1 chrome[1]: [a.cc:1] x", "DEBUG"],
    ["2026-08-31T06:17:25.000000Z EVENT chrome[1]: [a.cc:1] x", "INFO"]
  ])("normalizes %s", (line, level) => {
    expect(parseLogLine(line).level).toBe(level);
  });

  it("reads a kernel line with a syslog priority", () => {
    const log = parseLogLine(KERNEL_LINES[0]);

    expect(log.tsKind).toBe("monotonic");
    expect(log.ts).toBe(606417);
    expect(log.level).toBe("INFO");
    expect(log.process).toBe("kernel");
    expect(log.message).toBe("pcieport 0000:00:1c.0: AER: Corrected error received");
  });

  it("leaves the level empty when a kernel line carries no priority", () => {
    const log = parseLogLine(KERNEL_LINES[1]);

    expect(log.tsKind).toBe("monotonic");
    expect(log.ts).toBe(12_345_678);
    expect(log.level).toBe("");
  });

  it("keeps the component and file of a device_event_log line", () => {
    const log = parseLogLine(DEVICE_EVENT_LINE);

    expect(log.level).toBe("ERROR");
    expect(log.process).toBe("chrome[1016]");
    expect(log.source).toBe("USB: usb_service_linux.cc:255");
    expect(log.message).toBe("Failed to open device");
    // -07:00, so the instant is seven hours after the same digits in UTC.
    expect(log.ts).toBe(Date.parse("2026-08-31T06:17:31Z") * 1000 + 303993);
  });

  it("reads a bracketed-timestamp service line", () => {
    const log = parseLogLine(SERVICE_LINE);

    expect(log.tsKind).toBe("wall");
    expect(log.level).toBe("INFO");
    expect(log.source).toBe("service::usbfs_client::handler:293");
    expect(log.message).toBe("claimed interface 1");
  });

  it("reads a cras atlog line", () => {
    const log = parseLogLine(CRAS_LINE);

    expect(log.process).toBe("cras atlog");
    expect(log.tsKind).toBe("wall");
    expect(log.message).toBe("READ_AUDIO_TSTAMP dev:3 tstamp:123");
  });

  it("reads a level-prefixed line that has no timestamp", () => {
    const log = parseLogLine(AUDIT_LINE);

    expect(log.ts).toBeNull();
    expect(log.level).toBe("WARN");
    expect(log.process).toBe("audit_log_filter");
    expect(log.source).toBe("helpers/audit_log_filter.cc:57");
    expect(log.message).toBe("Failed to parse rule.");
  });

  it("reads a bare [LEVEL] line", () => {
    const log = parseLogLine("[WARN] battery is unhappy");

    expect(log.level).toBe("WARN");
    expect(log.ts).toBeNull();
    expect(log.message).toBe("battery is unhappy");
  });

  // The regression X3 was about: command output must never be handed a
  // timestamp, or the merged timeline sorts on a fabricated one.
  it.each(NON_LOG_LINES)("does not invent a timestamp for %s", (line) => {
    const log = parseLogLine(line);

    expect(log.ts).toBeNull();
    expect(log.timestamp).toBe("");
    expect(log.message).toBe(line);
  });

  it("leaves a very long line unstructured", () => {
    const line = `2026-08-31T06:17:25.000000Z INFO chrome[1]: ${"x".repeat(2100)}`;
    const log = parseLogLine(line);

    expect(log.ts).toBeNull();
    expect(log.message).toBe(line);
  });

  it("returns an empty entry for a blank line", () => {
    expect(parseLogLine("   ").message).toBe("");
  });
});

describe("section extraction", () => {
  it("pulls one section by name", () => {
    const content = extractLogSection(SYSTEM_LOGS_SAMPLE, "chrome_user_log");

    expect(content.split("\n")).toHaveLength(2);
    expect(content).toContain("boom");
  });

  it("pulls a section written behind a Profile[0] prefix", () => {
    expect(extractLogSection(SYSTEM_LOGS_SAMPLE, "login_times")).toContain("logged in");
  });

  it("parses every section at once", () => {
    const sections = parseAllLogSections(SYSTEM_LOGS_SAMPLE);

    expect(Object.keys(sections)).toEqual(["chrome_user_log", "login_times"]);
    expect(sections.chrome_user_log).toHaveLength(2);
    expect(sections.chrome_user_log[0].level).toBe("ERROR");
  });

  it("parses a named section into logs", () => {
    const logs = parseLogSection(SYSTEM_LOGS_SAMPLE, "chrome_user_log");

    expect(logs.map((log) => log.message)).toEqual(["boom", "fine"]);
  });

  it("streams the same sections asynchronously", async () => {
    const sections = await extractSectionsRawAsync(SYSTEM_LOGS_SAMPLE);

    expect(sections.map((section) => section.key)).toEqual(["chrome_user_log", "login_times"]);
    expect(sections[0].rawContent).toContain("boom");
  });
});

describe("field extraction", () => {
  it("reads the single-line fields outside any section", () => {
    const fields = extractSingleLineFields(SYSTEM_LOGS_SAMPLE);
    const keys = fields.map((field) => field.key);

    expect(keys).toContain("HWID");
    expect(keys).toContain("FREE_DISK_SPACE");
    expect(fields.find((field) => field.key === "HWID")?.value).toBe("ORTHRUS-ABCD A1B-C2D");
  });

  it("does not treat a log line inside a section as a field", () => {
    const keys = extractSingleLineFields(SYSTEM_LOGS_SAMPLE).map((field) => field.key);

    expect(keys.some((key) => key.includes("chrome["))).toBe(false);
  });

  it("reads the device header", () => {
    const info = parseDeviceInfo(SYSTEM_LOGS_SAMPLE);

    expect(info.board).toBe(Board.Orthrus);
    expect(info.version).toBe("16295.0.0");
    expect(info.arcStatus).toBe("enabled");
  });

  it("falls back to unknown for a board it does not know", () => {
    expect(parseDeviceInfo("CHROMEOS_RELEASE_BOARD=nocturne").board).toBe(Board.unknown);
  });
});
