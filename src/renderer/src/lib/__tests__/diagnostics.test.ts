import { describe, expect, it } from "vitest";
import { parseLogLine } from "../log-parser";
import { processFilesAsync } from "../log-processor";
import { resolveYearless, yearlessToMicros } from "../log-time";
import { buildSectionMap, sectionText } from "../log-sections";
import { findCrashes } from "../log-crashes";
import { serviceHealth } from "../log-services";
import { memorySnapshot } from "../log-memory";
import { networkSnapshot } from "../log-network";
import { deviceCards } from "../log-device";
import { collectEntities } from "../log-entities";
import { AnalyzedLog, runRules } from "../log-rules";

const section = (key: string, body: string) =>
  `${key}=<multiline>\n---------- START ----------\n${body}\n---------- END ----------\n`;

const analysed = (key: string, lines: string[]): AnalyzedLog[] =>
  lines.map((line) => ({ ...parseLogLine(line), sourceFile: `f::${key}` }));

describe("logcat lines", () => {
  it("parses threadtime and leaves the year for later", () => {
    const log = parseLogLine("09-23 08:37:42.088    54    54 E zygote64: option failed");

    expect(log.tsKind).toBe("yearless");
    expect(log.level).toBe("ERROR");
    expect(log.process).toBe("zygote64");
    expect(log.source).toBe("54:54");
    expect(log.message).toBe("option failed");
  });

  it("takes the year from the archive and rolls back over new year", () => {
    const placeholder = yearlessToMicros(12, 31, "23:59:00.000")!;
    const reference = Date.parse("2027-01-01T00:10:00Z") * 1000;

    expect(resolveYearless(placeholder, reference)).toBe(Date.parse("2026-12-31T23:59:00Z") * 1000);
  });

  it("lands on the wall clock once processed beside a timestamped section", async () => {
    const content =
      section("syslog", "2026-09-23T08:40:00.000000Z INFO rsyslogd[1]: start") +
      section("VibeAndroidContainer LOGCAT", "09-23 08:37:42.088    54    54 I zygote64: hello");

    const { parsedLogs } = await processFilesAsync([{ id: "1", name: "s.txt", content }], () => {});
    const log = parsedLogs["s.txt::VibeAndroidContainer LOGCAT"][0];

    expect(log.tsKind).toBe("wall");
    expect(log.ts).toBe(Date.parse("2026-09-23T08:37:42.088Z") * 1000);
  });
});

describe("buildSectionMap", () => {
  it("indexes sections and hides debugd placeholders", () => {
    const sections = buildSectionMap(
      `CHROME VERSION=1\n${section("Profile[0] chrome_user_log", "a")}${section("console-ramoops", "<no matches>")}`
    );

    expect(sectionText(sections, "chrome_user_log").trim()).toBe("a");
    expect(sectionText(sections, "console-ramoops")).toBe("");
  });
});

describe("findCrashes", () => {
  it("merges crash_reporter's notice with the kernel's segfault line for the same pid", () => {
    const logs = analysed("syslog", [
      "2026-09-23T08:00:00.000000Z INFO kernel: [  10.0] chrome[1234]: segfault at 0 ip 00007f sp 00007e error 4",
      "2026-09-23T08:00:00.500000Z WARNING crash_reporter[99]: Received crash notification for chrome[1234] sig 11, user 1000 group 1000 (handling)"
    ]);

    const crashes = findCrashes(logs, new Map());

    expect(crashes).toHaveLength(1);
    expect(crashes[0].title).toBe("chrome segfault");
    expect(crashes[0].detail).toContain("handling");
  });

  it("reads crash .meta files and flags a panic in the pstore console", () => {
    const sections = buildSectionMap(
      section(
        "/var/spool/crash/chrome.20260923.1.meta",
        "exec_name=chrome\nver=148.0\nsig=SIGSEGV\nupload_var_reportTimeMillis=1790150400000\npayload=/var/spool/crash/chrome.20260923.1.dmp\ndone=1"
      ) +
        section("console-ramoops-0", "[  5.0] Kernel panic - not syncing: hung_task: blocked tasks")
    );

    const crashes = findCrashes([], sections);

    expect(crashes.map((crash) => crash.title)).toEqual([
      "chrome · SIGSEGV",
      "Previous boot ended in a kernel failure"
    ]);
    expect(crashes[0].ts).toBe(1790150400000 * 1000);
    expect(crashes[0].detail).toContain("chrome.20260923.1.dmp");
  });

  it("ignores upstart stopping a job with SIGTERM", () => {
    const logs = analysed("upstart", [
      "2026-09-23T03:08:10.989127Z WARNING kernel: [   12.1] init: failsafe-delay main process (849) killed by TERM signal"
    ]);
    expect(findCrashes(logs, new Map())).toEqual([]);
  });
});

describe("serviceHealth", () => {
  it("counts per job from the upstart section only", () => {
    const lines = [
      "2026-09-23T03:08:11.892482Z WARNING kernel: [   13.0] init: p2p main process (2386) terminated with status 1",
      "2026-09-23T03:08:11.892513Z WARNING kernel: [   13.0] init: p2p main process ended, respawning",
      "2026-09-23T03:08:12.000000Z WARNING kernel: [   14.0] init: p2p respawning too fast, stopped"
    ];
    const health = serviceHealth([...analysed("syslog", lines), ...analysed("upstart", lines)]);

    expect(health).toHaveLength(1);
    expect(health[0]).toMatchObject({
      job: "p2p",
      failures: 1,
      respawns: 1,
      gaveUp: true,
      lastExit: "status 1"
    });
  });
});

describe("memorySnapshot", () => {
  it("stitches rotated vmlogs and reads mem_usage and PSI", () => {
    const header = "time pgmajfault pswpin pswpout cpuusage";
    const sections = buildSectionMap(
      section("vmlog.PREVIOUS", `${header}\n[0923/083340] 1 0 0 0.36`) +
        section("vmlog.LATEST", `${header}\n[0923/083342] 5 2 0 0.50`) +
        section(
          "mem_usage",
          "Browser 242 MB, 467 FDs open of 8192\nGPU [] 90 MB, 153 FDs open of 16384"
        ) +
        section(
          "psi_memory",
          "some avg10=1.50 avg60=0.20 avg300=0.00 total=10\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0"
        )
    );

    const memory = memorySnapshot(sections, Date.parse("2026-09-23T09:00:00Z") * 1000);

    expect(memory.vmlog?.rows.map((row) => row.values.pgmajfault)).toEqual([1, 5]);
    expect(memory.processes[0]).toEqual({
      name: "Browser",
      megabytes: 242,
      fds: 467,
      fdLimit: 8192
    });
    expect(memory.pressure[0].values[0]).toMatchObject({ kind: "some", avg10: 1.5 });
  });
});

describe("networkSnapshot", () => {
  it("reads the shill dump and takes the count out of croslog's noise", () => {
    const sections = buildSectionMap(
      section(
        "network_services",
        JSON.stringify({
          "/service/1": { Name: "idle", Type: "wifi", State: "idle" },
          "/service/0": {
            Name: "wifi_psk_0",
            Type: "wifi",
            State: "online",
            Strength: 78,
            Error: "no-failure",
            "Diagnostics.Disconnects": [1, 2]
          }
        })
      ) +
        section(
          "wifi_connection_attempts",
          "WARNING croslog: [x.cc:33] The line has leading NULLs.\n3"
        )
    );

    const network = networkSnapshot(sections);

    expect(network.services[0]).toMatchObject({ name: "wifi_psk_0", strength: 78, disconnects: 2 });
    expect(network.counters).toEqual([{ key: "wifi_connection_attempts", value: "3" }]);
  });
});

describe("deviceCards", () => {
  it("pulls USB ids, displays and input devices out of their dumps", () => {
    const content =
      "CHROME VERSION=148.0\n" +
      section(
        "lsusb",
        "/:  Bus 08.Port 1: Dev 1\n    ID 1d6b:0003 Linux Foundation 3.0 root hub\n    ID 2fe9:0203 Vibe Camera"
      ) +
      section(
        "edid-decode",
        "    Display Product Name: 'Panasonic-TV'\n    DTD 1:  3840x2160   60.000 Hz"
      ) +
      section("input_devices", 'N: Name="fd8b0030.pwm"');

    const cards = deviceCards(content, buildSectionMap(content));
    const byTitle = Object.fromEntries(cards.map((card) => [card.title, card.lines]));

    expect(byTitle["System"]).toEqual(["CHROME VERSION: 148.0"]);
    expect(byTitle["USB devices"]).toEqual(["2fe9:0203 Vibe Camera"]);
    expect(byTitle["Displays"]).toEqual([
      "Display Product Name: 'Panasonic-TV'",
      "DTD 1: 3840x2160 60.000 Hz"
    ]);
    expect(byTitle["Input devices"]).toEqual(["fd8b0030.pwm"]);
  });
});

describe("collectEntities", () => {
  it("counts each redaction token once per occurrence", () => {
    const logs = analysed("netlog", [
      "2026-09-23T03:08:11Z INFO shill[1]: connected to (MAC OUI=60:22:32 IFACE=5) via (IPv4: 3)",
      "2026-09-23T03:08:12Z INFO shill[1]: roamed from (MAC OUI=60:22:32 IFACE=5)",
      "2026-09-23T03:08:13Z INFO chrome[1]: (Error: 5) is not a token, (HASH:5c5a 7) is"
    ]);

    const entities = collectEntities(logs);

    expect(entities.map((entity) => [entity.token, entity.count])).toEqual([
      ["(MAC OUI=60:22:32 IFACE=5)", 2],
      ["(IPv4: 3)", 1],
      ["(HASH:5c5a 7)", 1]
    ]);
  });

  it("marks a token seen on an untimed line as not mergeable", () => {
    const logs = [
      ...analysed("netlog", ["2026-09-23T03:08:11.000000Z INFO shill[1]: via (IPv4: 3)"]),
      ...analysed("network_services", ['"Address": "(IPv4: 3)",']),
      ...analysed("netlog", ["2026-09-23T03:08:12.000000Z INFO shill[1]: dns (IPv4: 4)"])
    ];

    const timed = Object.fromEntries(
      collectEntities(logs).map((entity) => [entity.token, entity.timed])
    );

    expect(timed).toEqual({ "(IPv4: 3)": false, "(IPv4: 4)": true });
  });
});

describe("ui-restart rule", () => {
  const fires = (message: string) =>
    runRules([{ message, sourceFile: "f::syslog" }]).some(
      (finding) => finding.rule.id === "ui-restart"
    );

  it("ignores what every shutdown and sign-out logs", () => {
    expect(fires("ui-post-stop")).toBe(false);
    expect(fires("SessionManagerService exiting")).toBe(false);
    expect(fires("Terminating browser process 7449 with signal 15: exiting cleanly")).toBe(false);
    expect(fires("Browser process 7449 exited with exit code 0")).toBe(false);
    expect(fires("Browser process 7449 exited with signal 15 (Terminated)")).toBe(false);
  });

  it("fires when the browser dies or hangs", () => {
    expect(fires("Browser process 7449 exited with signal 11 (Segmentation fault)")).toBe(true);
    expect(fires("Browser process 7449 exited with exit code 1")).toBe(true);
    expect(fires("Browser hang detected!")).toBe(true);
  });
});
