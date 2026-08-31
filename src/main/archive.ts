import AdmZip from "adm-zip";
import * as fs from "fs";
import * as path from "path";

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
  ".gz",
  ".bz2",
  ".xz",
  ".zst",
  ".tar",
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

const collectFromZip = (
  data: Buffer,
  prefix: string,
  collected: ExtractedLogFile[],
  depth: number
): void => {
  if (depth > MAX_NESTING) return;

  for (const entry of new AdmZip(data).getEntries()) {
    if (entry.isDirectory || isArchiveNoise(entry.entryName)) continue;

    const name = `${prefix}/${entry.entryName}`;
    const extension = path.extname(entry.entryName).toLowerCase();

    if (extension === ".zip") {
      try {
        collectFromZip(entry.getData(), name, collected, depth + 1);
      } catch (err) {
        console.error(`[Archive] Skipping unreadable nested zip ${name}:`, err);
      }
      continue;
    }

    const mimeType = IMAGE_MIME_TYPES[extension];
    if (mimeType) {
      collected.push({ name, content: "", imageDataUrl: toDataUrl(entry.getData(), mimeType) });
      continue;
    }

    if (BINARY_EXTENSIONS.has(extension)) continue;

    const content = entry.getData();
    if (looksBinary(content)) continue;

    collected.push({ name, content: content.toString("utf8") });
  }
};

/**
 * Reads a log file, or every readable log inside an archive. Archives used to
 * yield only system_logs.txt, which silently dropped the crash logs, per-service
 * logs and nested archives that sit beside it.
 */
export const readLogFile = (filePath: string): ExtractedLogFile[] => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const fileName = path.basename(filePath);
  const extension = path.extname(filePath).toLowerCase();

  if (extension !== ".zip") {
    const mimeType = IMAGE_MIME_TYPES[extension];
    if (mimeType) {
      return [
        {
          name: fileName,
          content: "",
          imageDataUrl: toDataUrl(fs.readFileSync(filePath), mimeType)
        }
      ];
    }
    return [{ name: fileName, content: fs.readFileSync(filePath, "utf-8") }];
  }

  const collected: ExtractedLogFile[] = [];
  collectFromZip(fs.readFileSync(filePath), fileName, collected, 0);

  if (collected.length === 0) {
    throw new Error(`No readable log files found in ${fileName}`);
  }

  collected.sort((a, b) => {
    const rank = Number(PRIMARY_ENTRY.test(b.name)) - Number(PRIMARY_ENTRY.test(a.name));
    return rank !== 0 ? rank : a.name.localeCompare(b.name);
  });

  return collected;
};
