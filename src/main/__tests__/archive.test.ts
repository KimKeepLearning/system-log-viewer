import { describe, expect, it } from "vitest";
import { gzipSync } from "zlib";
import AdmZip from "adm-zip";
import { extractLogBuffer, readTar } from "../archive";

const tarHeader = (name: string, size: number, type = "0"): Buffer => {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(size.toString(8).padStart(11, "0"), 124, 12, "latin1");
  header.write(type, 156, 1, "latin1");
  header.write("ustar", 257, 5, "latin1");
  return header;
};

const tar = (entries: { name: string; content: string | Buffer; type?: string }[]): Buffer => {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content);
    blocks.push(tarHeader(entry.name, body.length, entry.type));
    blocks.push(Buffer.concat([body, Buffer.alloc((512 - (body.length % 512)) % 512)]));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
};

describe("readTar", () => {
  it("reads regular files and GNU long names, and skips directories", () => {
    const longName = `var/log/${"a".repeat(120)}.log`;
    const entries = readTar(
      tar([
        { name: "var/log/", content: "", type: "5" },
        { name: "var/log/messages", content: "hello\n" },
        { name: "././@LongLink", content: `${longName}\0`, type: "L" },
        { name: "truncated", content: "long\n" }
      ])
    );

    expect(entries.map((entry) => entry.name)).toEqual(["var/log/messages", longName]);
    expect(entries[1].data.toString()).toBe("long\n");
  });
});

describe("extractLogBuffer", () => {
  it("folds a /var/log tarball into one file of sections", () => {
    const archive = gzipSync(
      tar([
        { name: "logs/log/messages", content: "2026-09-23T03:08:05.006602Z INFO kernel: hi\n" },
        { name: "logs/log/chrome/chrome", content: "line\n" },
        { name: "logs/log/lastlog", content: Buffer.from([0, 1, 2, 3]) },
        { name: "logs/log/messages.1.gz", content: gzipSync("older\n") },
        ...Array.from({ length: 6 }, (_, index) => ({
          name: `logs/log/metrics/shutdown.1/uptime-${index}`,
          content: `${index}.5\n`
        }))
      ])
    );

    const [file] = extractLogBuffer("debug.tgz", archive);

    expect(file.name).toBe("debug.tgz");
    expect(file.content).toContain("messages=<multiline>\n---------- START ----------\n");
    expect(file.content).toContain("chrome/chrome=<multiline>");
    expect(file.content).toContain("messages.1=<multiline>\n---------- START ----------\nolder\n");
    expect(file.content).toContain("metrics/shutdown.1/*=<multiline>");
    expect(file.content).toContain("uptime-3: 3.5");
    expect(file.content).not.toContain("lastlog");
  });

  it("strips debugd's feedback/ and var/log/ prefixes so keys match system_logs.txt", () => {
    const archive = tar([
      { name: "feedback/syslog", content: "a\n" },
      { name: "var/log/net.log", content: "b\n" }
    ]);

    const [file] = extractLogBuffer("debug-logs.tar", archive);

    expect(file.content).toContain("syslog=<multiline>");
    expect(file.content).toContain("net.log=<multiline>");
  });

  it("still opens a feedback zip entry by entry", () => {
    const inner = new AdmZip();
    inner.addFile("system_logs.txt", Buffer.from("CHROME VERSION=1\n"));
    const outer = new AdmZip();
    outer.addFile("datas/system_logs.zip", inner.toBuffer());
    outer.addFile("datas/variations.binary", Buffer.from("abc"));

    const files = extractLogBuffer("report.zip", outer.toBuffer());

    expect(files.map((file) => file.name)).toEqual(["report.zip/datas/system_logs.zip/system_logs.txt"]);
  });

  it("reads a plain log as text", () => {
    expect(extractLogBuffer("chrome", Buffer.from("x\n"))).toEqual([{ name: "chrome", content: "x\n" }]);
  });
});
