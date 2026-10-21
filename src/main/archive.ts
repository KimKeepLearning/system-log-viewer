import AdmZip from "adm-zip";
import * as fs from "fs";
import * as path from "path";
import { gunzipSync } from "zlib";

/**
 * One log file as it crosses the IPC boundary. A single dropped archive can
 * produce many of these, so `name` is the display path inside it, e.g.
 * "feedback.zip/system_logs.txt".
 *
 * The renderer sees this shape through the global declared in
 * src/preload/index.d.ts; the two must stay in sync.
 */
export interface ExtractedLogFile {
  name: string;
  /** Text content. Empty when the entry is an image. */
  content: string;
  /** A `data:` URL, set only for image entries such as the feedback screenshot. */
  imageDataUrl?: string;
}

// Feedback archives carry a screenshot, which is often faster to read than the
// logs beside it, so images are surfaced rather than skipped as binary.
const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp"
};

// Nested archives are common (feedback.zip containing system_logs.zip), but a
// deep chain means something is wrong rather than something worth unpacking.
const MAX_NESTING = 4;

const BINARY_EXTENSIONS = new Set([
  ".ico",
  ".pdf",
  // Chrome's feedback archives ship datas/variations.binary, a protobuf that
  // happens to carry no NUL bytes early on and so slips past looksBinary.
  ".binary",
  ".dmp",
  ".core",
  ".bz2",
  ".xz",
  ".zst",
  ".so",
  ".bin",
  ".pb",
  ".dat",
  ".mp4",
  ".webm",
  ".wav"
]);

// system_logs is what people opened the archive for; everything else in it is
// supporting evidence and should sort after.
const PRIMARY_ENTRY = /(^|\/)system_logs(\.txt)?$/i;

const isArchiveNoise = (entryName: string): boolean => {
  const normalized = entryName.replace(/\\/g, "/");
  if (normalized.toLowerCase().includes("__macosx")) return true;
  return normalized.split("/").some((segment) => segment.startsWith("._"));
};

// Decoding to UTF-8 never fails, so a NUL byte is the usable signal: no text
// log contains one, and the binary formats we want to skip have them early.
const looksBinary = (data: Buffer): boolean => data.subarray(0, 8192).includes(0);

const toDataUrl = (data: Buffer, mimeType: string): string =>
  `data:${mimeType};base64,${data.toString("base64")}`;

const isZip = (data: Buffer): boolean =>
  data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;

const isGzip = (data: Buffer): boolean => data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;

const isTar = (data: Buffer): boolean =>
  data.length >= 512 && data.toString("latin1", 257, 262) === "ustar";

const stripGzipSuffix = (name: string): string =>
  name.replace(/\.tgz$/i, ".tar").replace(/\.gz$/i, "");

interface TarEntry {
  name: string;
  data: Buffer;
}

const cString = (buffer: Buffer, start: number, length: number): string => {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.toString("utf8", 0, end === -1 ? slice.length : end);
};

const tarSize = (header: Buffer): number => {
  // GNU base-256 for entries of 8 GiB and up; nothing a log archive holds, but
  // misreading it as octal would desynchronise every header after it.
  if (header[124] & 0x80) {
    let size = 0;
    for (let i = 125; i < 136; i++) size = size * 256 + header[i];
    return size;
  }
  return parseInt(cString(header, 124, 12).trim() || "0", 8);
};

const paxPath = (body: Buffer): string | null => {
  for (const record of body.toString("utf8").split("\n")) {
    const match = /^\d+ path=(.*)$/.exec(record);
    if (match) return match[1];
  }
  return null;
};

/** Regular files only: ustar, GNU long names and pax paths, which is what GNU tar and debugd write. */
export const readTar = (data: Buffer): TarEntry[] => {
  const entries: TarEntry[] = [];
  let offset = 0;
  let longName: string | null = null;

  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header[0] === 0) break;

    const size = tarSize(header);
    const type = String.fromCharCode(header[156] || 0x30);
    const body = data.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === "L") {
      longName = cString(body, 0, body.length);
      continue;
    }
    if (type === "x") {
      longName = paxPath(body) ?? longName;
      continue;
    }
    if (type !== "0" && type !== "7") {
      longName = null;
      continue;
    }

    const prefix = cString(header, 345, 155);
    const shortName = cString(header, 0, 100);
    const name = longName ?? (prefix ? `${prefix}/${shortName}` : shortName);
    longName = null;
    entries.push({ name: name.replace(/^\.\//, ""), data: body });
  }

  return entries;
};

/**
 * A /var/log tarball is a few hundred files, most of which mean little alone.
 * Folding them into one system_logs-style file makes each a section, which is
 * what lets Merge interleave messages, chrome, ui and powerd on one timeline
 * and lets the overview find vmlog or crash .meta files by name.
 */
const SECTION_START = "---------- START ----------";
const SECTION_END = "---------- END ----------";

const commonDirectory = (names: string[]): string => {
  if (names.length === 0) return "";
  const split = names.map((name) => name.split("/").slice(0, -1));
  const first = split[0];
  let length = first.length;
  for (const parts of split) {
    let i = 0;
    while (i < length && parts[i] === first[i]) i++;
    length = i;
  }
  return length > 0 ? `${first.slice(0, length).join("/")}/` : "";
};

// debugd's DumpDebugLogs writes each feedback log as feedback/<key>, the same
// key system_logs.txt uses, so stripping the folder lets the same parsers read
// both. var/log/ is noise in front of every other name.
const sectionNameFor = (relative: string): string =>
  relative.replace(/^feedback\//, "").replace(/^var\/log\//, "");

// metrics/shutdown.*/ holds forty one-line files per shutdown; as sections they
// would bury everything else in the sidebar.
const TINY_FILE_BYTES = 256;
const TINY_DIRECTORY_MIN_FILES = 5;

interface TextEntry {
  name: string;
  content: string;
}

const foldTinyDirectories = (entries: TextEntry[]): TextEntry[] => {
  const byDirectory = new Map<string, TextEntry[]>();
  for (const entry of entries) {
    const directory = entry.name.includes("/")
      ? entry.name.slice(0, entry.name.lastIndexOf("/"))
      : "";
    const list = byDirectory.get(directory) ?? [];
    list.push(entry);
    byDirectory.set(directory, list);
  }

  const result: TextEntry[] = [];
  for (const [directory, list] of byDirectory) {
    const tiny =
      directory !== "" &&
      list.length >= TINY_DIRECTORY_MIN_FILES &&
      list.every(
        (entry) => entry.content.length <= TINY_FILE_BYTES && !entry.content.trim().includes("\n")
      );
    if (!tiny) {
      result.push(...list);
      continue;
    }
    result.push({
      name: `${directory}/*`,
      content: list
        .map((entry) => `${entry.name.slice(directory.length + 1)}: ${entry.content.trim()}`)
        .join("\n")
    });
  }
  return result;
};

export const combineAsSections = (entries: TextEntry[]): string => {
  const prefix = commonDirectory(entries.map((entry) => entry.name));
  const relative = entries
    .filter((entry) => entry.content.trim().length > 0)
    .map((entry) => ({
      name: sectionNameFor(entry.name.slice(prefix.length)),
      content: entry.content
    }));

  return foldTinyDirectories(relative)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (entry) =>
        `${entry.name}=<multiline>\n${SECTION_START}\n${entry.content.replace(/\n?$/, "\n")}${SECTION_END}\n`
    )
    .join("");
};

const collectFromTar = (
  data: Buffer,
  archiveName: string,
  collected: ExtractedLogFile[],
  depth: number
): void => {
  const texts: TextEntry[] = [];

  for (const entry of readTar(data)) {
    if (isArchiveNoise(entry.name)) continue;

    let name = entry.name;
    let body = entry.data;
    // Rotated logs are often messages.1.gz and the like.
    if (isGzip(body)) {
      try {
        body = gunzipSync(body);
        name = stripGzipSuffix(name);
      } catch {
        continue;
      }
    }

    // Archives and images inside the tarball stay separate files; only plain
    // text joins the combined view.
    const extension = path.extname(name).toLowerCase();
    if (isZip(body) || isTar(body) || IMAGE_MIME_TYPES[extension]) {
      collectBuffer(`${archiveName}/${name}`, body, collected, depth + 1);
      continue;
    }
    if (BINARY_EXTENSIONS.has(extension) || looksBinary(body)) continue;
    texts.push({ name, content: body.toString("utf8") });
  }

  if (texts.length > 0) collected.push({ name: archiveName, content: combineAsSections(texts) });
};

const collectFromZip = (
  data: Buffer,
  prefix: string,
  collected: ExtractedLogFile[],
  depth: number
): void => {
  for (const entry of new AdmZip(data).getEntries()) {
    if (entry.isDirectory || isArchiveNoise(entry.entryName)) continue;
    collectBuffer(`${prefix}/${entry.entryName}`, entry.getData(), collected, depth + 1);
  }
};

const collectBuffer = (
  name: string,
  data: Buffer,
  collected: ExtractedLogFile[],
  depth: number
): void => {
  if (depth > MAX_NESTING) return;
  const extension = path.extname(name).toLowerCase();

  try {
    if (isZip(data)) return collectFromZip(data, name, collected, depth);
    if (isGzip(data)) {
      const inner = gunzipSync(data);
      // A tarball keeps the name it was dropped as; a single .gz is the file inside.
      return collectBuffer(
        isTar(inner) ? name : stripGzipSuffix(name),
        inner,
        collected,
        depth + 1
      );
    }
    if (isTar(data)) return collectFromTar(data, name, collected, depth);
  } catch (err) {
    console.error(`[Archive] Skipping unreadable archive ${name}:`, err);
    return;
  }

  const mimeType = IMAGE_MIME_TYPES[extension];
  if (mimeType) {
    collected.push({ name, content: "", imageDataUrl: toDataUrl(data, mimeType) });
    return;
  }

  if (BINARY_EXTENSIONS.has(extension) || looksBinary(data)) return;
  collected.push({ name, content: data.toString("utf8") });
};

/**
 * Every readable log in a file, whatever it is: a plain log, a feedback zip, a
 * debug-logs .tgz, or any nesting of them. `name` is how the file is labelled.
 */
export const extractLogBuffer = (name: string, data: Buffer): ExtractedLogFile[] => {
  const collected: ExtractedLogFile[] = [];
  collectBuffer(name, data, collected, 0);

  if (collected.length === 0) {
    throw new Error(`No readable log files found in ${name}`);
  }

  collected.sort((a, b) => {
    const rank = Number(PRIMARY_ENTRY.test(b.name)) - Number(PRIMARY_ENTRY.test(a.name));
    return rank !== 0 ? rank : a.name.localeCompare(b.name);
  });

  return collected;
};

export const readLogFile = (filePath: string): ExtractedLogFile[] => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  return extractLogBuffer(path.basename(filePath), fs.readFileSync(filePath));
};
