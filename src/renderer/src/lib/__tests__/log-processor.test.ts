import { describe, expect, it } from "vitest";
import { processFilesAsync } from "../log-processor";
import { SYSLOG_SAMPLE, SYSTEM_LOGS_SAMPLE } from "./fixtures";

const noop = () => {};

describe("processFilesAsync", () => {
  it("builds the structure and per-section stats", async () => {
    const { structure, parsedLogs, sectionStats } = await processFilesAsync(
      [{ id: "1", name: "system_logs.txt", content: SYSTEM_LOGS_SAMPLE }],
      noop
    );

    expect(structure["system_logs.txt"]).toEqual([
      "system_logs.txt::chrome_user_log",
      "system_logs.txt::login_times"
    ]);
    expect(parsedLogs["system_logs.txt::chrome_user_log"]).toHaveLength(2);
    expect(sectionStats["system_logs.txt::chrome_user_log"].errors).toBe(1);
  });

  it("moves kernel lines onto the wall clock using the syslog relay", async () => {
    const content = `${SYSTEM_LOGS_SAMPLE}
dmesg=<multiline>
---------- START ----------
<4>[   25.000000] cros-ec-spi spi0.0: EC communication failed
---------- END ----------
syslog=<multiline>
---------- START ----------
${SYSLOG_SAMPLE}
---------- END ----------
`;

    const { parsedLogs } = await processFilesAsync([{ id: "1", name: "logs.txt", content }], noop);
    const kernel = parsedLogs["logs.txt::dmesg"][0];

    expect(kernel.tsKind).toBe("wall");
    // Boot sits at 06:17:50, so 25s of uptime is 06:18:15.
    expect(kernel.ts).toBe(Date.parse("2026-08-31T06:18:15Z") * 1000);
  });

  it("renames a second file of the same name instead of overwriting it", async () => {
    const { structure, updatedFiles } = await processFilesAsync(
      [
        { id: "1", name: "log.txt", content: "[WARN] one" },
        { id: "2", name: "log.txt", content: "[WARN] two" }
      ],
      noop
    );

    expect(updatedFiles.map((file) => file.name)).toEqual(["log.txt", "log.txt (1)"]);
    expect(Object.keys(structure)).toEqual(["log.txt", "log.txt (1)"]);
  });
});
