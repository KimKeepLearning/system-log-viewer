import { describe, expect, it } from "vitest";
import { AiMark, createLogTools } from "../ai-tools";
import { createRedactor } from "../log-redact";
import { processFilesAsync } from "../log-processor";

const CONTENT = `CHROMEOS_RELEASE_BOARD=orthrus
CHROMEOS_RELEASE_VERSION=16295.0.0
chrome_user_log=<multiline>
---------- START ----------
2026-08-31T06:17:25.000000Z INFO chrome[1016:1016]: [wifi.cc:10] Connecting to SSID: HomeWifi
2026-08-31T06:17:26.000000Z ERROR chrome[1016:1016]: [wifi.cc:42] Wi-Fi disconnected, reason 3
2026-08-31T06:17:27.000000Z INFO chrome[1016:1016]: [ui.cc:1] User clicked retry
---------- END ----------
syslog=<multiline>
---------- START ----------
2026-08-31T06:17:26.500000Z WARN shill[900]: [wifi.cc:7] Disconnect from 10.0.0.1
---------- END ----------
`;

const setup = async () => {
  const { parsedLogs, updatedFiles } = await processFilesAsync(
    [{ id: "1", name: "system_logs.txt", content: CONTENT }],
    () => {}
  );
  const marks: AiMark[] = [];
  const tools = createLogTools(updatedFiles, parsedLogs, createRedactor(), (mark) =>
    marks.push(mark)
  );
  return { tools, marks };
};

describe("createLogTools", () => {
  it("searches across sections and redacts what it returns", async () => {
    const { tools } = await setup();
    const result = tools.call("search_logs", {
      query: "disconnect",
      regex: false,
      section: null,
      level: null,
      limit: 10
    });

    expect(result).toContain("2 matches");
    expect(result).toContain("s0:1 | 2026-08-31T06:17:26.000000Z | chrome_user_log | ERROR");
    expect(result).toContain("s1:0");
    expect(result).toContain("<ip-1>");
    expect(result).not.toContain("10.0.0.1");
  });

  it("narrows by section and level, and reports a bad regex instead of throwing", async () => {
    const { tools } = await setup();
    const narrowed = tools.call("search_logs", {
      query: "wi-?fi|ssid",
      regex: true,
      section: "chrome_user_log",
      level: "ERROR",
      limit: 10
    });
    expect(narrowed).toContain("1 match:");

    expect(
      tools.call("search_logs", { query: "(", regex: true, section: null, level: null, limit: 5 })
    ).toMatch(/^Invalid regex/);
  });

  it("reads a window around a ref and marks lines by ref", async () => {
    const { tools, marks } = await setup();
    const window = tools.call("read_logs", { ref: "s0:1", before: 1, after: 1 });

    expect(window).toContain("lines 0-2 of 3");
    expect(window).toContain("> s0:1");
    expect(window).toContain("SSID: <ssid-1>");

    expect(tools.call("mark_line", { ref: "s0:1", kind: "cause", note: "掉线" })).toBe("Marked.");
    expect(marks).toEqual([
      {
        ref: "s0:1",
        key: "system_logs.txt::chrome_user_log",
        index: 1,
        kind: "cause",
        note: "掉线"
      }
    ]);
    expect(tools.call("mark_line", { ref: "s9:0", kind: "cause", note: "x" })).toMatch(
      /^Unknown ref/
    );
  });

  it("starts the model with an overview that lists every section by id", async () => {
    const { tools } = await setup();
    const context = tools.context();

    expect(context).toContain("Device: orthrus 16295.0.0");
    expect(context).toContain("s0 | system_logs.txt/chrome_user_log | 3 | 1 |");
    expect(context).toContain("s1 | system_logs.txt/syslog | 1 | 0 |");
  });
});
