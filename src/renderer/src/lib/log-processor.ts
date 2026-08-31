import { LogFileContext, IUserLog, SectionStats } from "./typings";
import { parseLogLine, extractSectionsRawAsync } from "./log-parser";
import { deriveBootAnchor } from "./log-time";

export interface ProcessedLogData {
  parsedLogs: Record<string, IUserLog[]>;
  structure: Record<string, string[]>;
  updatedFiles: LogFileContext[];
  sectionStats: Record<string, SectionStats>;
}

const summarize = (logs: IUserLog[]): SectionStats => {
  const stats: SectionStats = {
    lines: logs.length,
    errors: 0,
    warnings: 0,
    firstTs: null,
    lastTs: null
  };

  for (const log of logs) {
    if (log.level === "ERROR") stats.errors++;
    else if (log.level === "WARN") stats.warnings++;

    if (log.tsKind === "wall" && typeof log.ts === "number") {
      if (stats.firstTs === null || log.ts < stats.firstTs) stats.firstTs = log.ts;
      if (stats.lastTs === null || log.ts > stats.lastTs) stats.lastTs = log.ts;
    }
  }

  return stats;
};

const LINES_CHUNK_SIZE = 5000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseContentByLines(
  content: string,
  onChunk?: () => Promise<void>
): Promise<IUserLog[]> {
  const logs: IUserLog[] = [];
  let chunk: string[] = [];
  let startIndex = 0;
  let newlineIndex = content.indexOf("\n", startIndex);

  while (startIndex < content.length) {
    let line: string;
    if (newlineIndex === -1) {
      line = content.substring(startIndex);
      startIndex = content.length;
    } else {
      line = content.substring(startIndex, newlineIndex);
      startIndex = newlineIndex + 1;
      newlineIndex = content.indexOf("\n", startIndex);
    }

    const trimmed = line.trim();
    if (trimmed.length > 0) {
      chunk.push(trimmed);
    }

    if (chunk.length >= LINES_CHUNK_SIZE) {
      const chunkLogs = chunk.map(parseLogLine);
      logs.push(...chunkLogs);
      chunk = [];
      if (onChunk) await onChunk();
    }
  }

  // Process remaining items
  if (chunk.length > 0) {
    const chunkLogs = chunk.map(parseLogLine);
    logs.push(...chunkLogs);
  }

  return logs;
}

/**
 * Kernel logs count seconds since boot while everything else records wall
 * clock, so on their own they cannot be interleaved. The syslog section relays
 * kernel messages with both clocks attached, which is enough to place monotonic
 * zero on the wall-clock timeline and shift the kernel entries onto it.
 */
function anchorMonotonicLogs(
  parsedLogs: Record<string, IUserLog[]>,
  sectionKeys: string[],
  rawSections: { key: string; rawContent: string }[]
): void {
  const syslog = rawSections.find((section) => section.key === "syslog");
  if (!syslog) return;

  const anchor = deriveBootAnchor(syslog.rawContent);
  if (!anchor) return;

  for (const key of sectionKeys) {
    for (const log of parsedLogs[key] ?? []) {
      if (log.tsKind === "monotonic" && log.ts !== null && log.ts !== undefined) {
        log.ts += anchor.bootEpochUs;
        log.tsKind = "wall";
      }
    }
  }
}

export async function processFilesAsync(
  files: LogFileContext[],
  onProgress: (status: string) => void
): Promise<ProcessedLogData> {
  const parsedLogs: Record<string, IUserLog[]> = {};
  const structure: Record<string, string[]> = {};
  const updatedFiles: LogFileContext[] = [];
  const sectionStats: Record<string, SectionStats> = {};

  // Track seen file names to handle duplicates
  const seenNames = new Map<string, number>();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    // Generate unique display name if needed
    let displayName = file.name;
    const count = seenNames.get(file.name) || 0;
    if (count > 0) {
      displayName = `${file.name} (${count})`;
    }
    seenNames.set(file.name, count + 1);

    updatedFiles.push({ ...file, name: displayName });

    // Images are kept for the screenshot viewer but have nothing to parse, and
    // giving them a (always empty) entry in the structure would only clutter
    // the log sidebar.
    if (file.imageDataUrl) continue;

    onProgress(`Processing ${displayName} (${i + 1}/${files.length})...`);
    await sleep(20);

    const sections: string[] = [];

    // 1. Try generic structured parsing
    // Optimization: Check for signatures before running heavy regex to avoid freezing on large plain files
    const hasSectionSignature =
      file.content.includes("=<multiline>") && file.content.includes("START");
    let rawSections: { key: string; rawContent: string }[] = [];

    if (hasSectionSignature) {
      onProgress(`Scanning for sections in ${displayName}...`);
      await sleep(20);
      // Use async extraction to prevent main thread freeze
      rawSections = await extractSectionsRawAsync(file.content, async () => {
        await sleep(5);
      });
    }

    if (rawSections.length > 0) {
      for (const section of rawSections) {
        // Build unique key
        const uniqueKey = `${displayName}::${section.key}`;

        // Parse content using iterator to save memory
        if (section.rawContent.length > 100000) {
          onProgress(`Parsing huge section: ${section.key}...`);
          await sleep(10);
        }

        const logs = await parseContentByLines(section.rawContent, async () => {
          // Yield occasionally
          await sleep(5);
        });

        parsedLogs[uniqueKey] = logs;
        sections.push(uniqueKey);
      }

      // Stats are taken after anchoring so the kernel sections report the wall
      // clock range the timeline will actually place them at.
      anchorMonotonicLogs(parsedLogs, sections, rawSections);
      for (const key of sections) sectionStats[key] = summarize(parsedLogs[key]);
    } else if (file.content.trim().length > 0) {
      // Fallback: Line-by-line parsing
      onProgress(`Parsing ${displayName} content...`);
      await sleep(10);

      const uniqueKey = `${displayName}::Main`;

      const logs = await parseContentByLines(file.content, async () => {
        // Yield every chunk for the main file
        await sleep(10);
      });

      if (logs.length > 0) {
        parsedLogs[uniqueKey] = logs;
        sections.push(uniqueKey);
        sectionStats[uniqueKey] = summarize(logs);
      }
    }

    structure[displayName] = sections;
  }

  return { parsedLogs, structure, updatedFiles, sectionStats };
}
