import { describe, expect, it } from "vitest";
import { diffArchives, summariseArchive } from "../log-diff";
import { processFilesAsync } from "../log-processor";

const archive = (body: string) => `CHROMEOS_RELEASE_BOARD=orthrus
CHROMEOS_RELEASE_VERSION=${body.includes("Oops") ? "16300.0.0" : "16295.0.0"}
HWID=ORTHRUS-ABCD
${body}`;

const section = (name: string, lines: string[]) => `${name}=<multiline>
---------- START ----------
${lines.join("\n")}
---------- END ----------
`;

const GOOD = archive(
  section("chrome_user_log", [
    "2026-08-31T06:17:25.000000Z ERROR chrome[1016:1016]: [a.cc:1] Failed to open device 12",
    "2026-08-31T06:17:26.000000Z INFO chrome[1016:1016]: [a.cc:2] fine"
  ]) + section("only_on_good", ["2026-08-31T06:17:27.000000Z INFO powerd[900]: [p.cc:1] ok"])
);

const BAD = archive(
  section("chrome_user_log", [
    "2026-08-31T06:17:25.000000Z ERROR chrome[1016:1016]: [a.cc:1] Failed to open device 13",
    "2026-08-31T06:17:25.500000Z ERROR chrome[1016:1016]: [a.cc:1] Failed to open device 14",
    "2026-08-31T06:17:26.000000Z ERROR chrome[1016:1016]: [a.cc:9] GPU process crashed"
  ]) + section("dmesg", ["<4>[    3.000000] Oops: 0000 [#1] PREEMPT SMP"])
);

const summarise = async (content: string) => {
  const { parsedLogs, updatedFiles } = await processFilesAsync(
    [{ id: "1", name: "system_logs.txt", content }],
    () => {}
  );
  return summariseArchive(updatedFiles, parsedLogs);
};

describe("diffArchives", () => {
  it("lines up sections, fields, templates and findings across two archives", async () => {
    const diff = diffArchives(await summarise(GOOD), await summarise(BAD));

    expect(
      diff.sections
        .slice(0, 2)
        .map((entry) => entry.name)
        .sort()
    ).toEqual(["dmesg", "only_on_good"]);
    expect(diff.sections.find((entry) => entry.name === "chrome_user_log")).toMatchObject({
      a: { lines: 2, errors: 1 },
      b: { lines: 3, errors: 3 }
    });

    expect(diff.fields).toEqual([
      { key: "CHROMEOS_RELEASE_VERSION", a: "16295.0.0", b: "16300.0.0" }
    ]);

    // The device numbers differ line to line; the template does not.
    const failedOpen = diff.templates.find((entry) => entry.key === "Failed to open device N");
    expect(failedOpen).toMatchObject({ a: 1, b: 2 });
    expect(failedOpen?.sample?.message).toBe("Failed to open device 12");

    expect(diff.templates[0]).toMatchObject({ key: "GPU process crashed", a: 0, b: 1 });
    expect(diff.templates[0].sample).toBeUndefined();

    expect(diff.findings[0]).toMatchObject({ key: "kernel-panic", a: 0, b: 1 });
  });

  it("reports nothing for an archive compared with itself", async () => {
    const summary = await summarise(BAD);
    const diff = diffArchives(summary, summary);

    expect(diff.fields).toEqual([]);
    expect(diff.templates).toEqual([]);
    expect(diff.findings.every((entry) => entry.a === entry.b)).toBe(true);
  });
});
