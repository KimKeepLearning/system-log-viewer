/**
 * Timestamps are kept as epoch **microseconds**. ChromeOS logs carry six
 * fractional digits and many entries share a millisecond, so millisecond
 * resolution would lose their order. Microseconds since 1970 are around 1.8e15,
 * comfortably inside the 2^53 range where a JS number is still an exact
 * integer.
 */
export type TimestampKind = "wall" | "monotonic" | "yearless";

// Either "2026-08-31T06:17:23.867672Z" or "2026-08-30T23:17:31.303993-07:00".
// Both appear in a single system_logs.txt: services log UTC, while
// device_event_log and network_event_log log with the device's offset.
const ISO_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?$/;

export const parseWallTimestamp = (raw: string): number | null => {
  const match = ISO_TIMESTAMP.exec(raw);
  if (!match) return null;

  const [, date, time, fraction, zone] = match;

  // Date.parse resolves to milliseconds, so the sub-millisecond digits are
  // added back separately. A missing zone is read as UTC rather than local
  // time, so the same log file does not shift with the reader's machine.
  const milliseconds = Date.parse(`${date}T${time}${zone ?? "Z"}`);
  if (Number.isNaN(milliseconds)) return null;

  const micros = fraction ? Math.round(Number(`0.${fraction}`) * 1_000_000) : 0;
  return milliseconds * 1000 + micros;
};

export const monotonicSecondsToMicros = (seconds: string): number =>
  Math.round(Number(seconds) * 1_000_000);

// A leap year, so a Feb 29 stamp survives until the real year is known.
const PLACEHOLDER_YEAR = 2000;

/** For stamps like logcat's "09-23 08:37:42.088"; log-processor fills in the year. */
export const yearlessToMicros = (month: number, day: number, time: string): number | null => {
  const match = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/.exec(time);
  if (!match) return null;
  const milliseconds = Date.UTC(
    PLACEHOLDER_YEAR,
    month - 1,
    day,
    Number(match[1]),
    Number(match[2]),
    Number(match[3])
  );
  const micros = match[4] ? Math.round(Number(`0.${match[4]}`) * 1_000_000) : 0;
  return milliseconds * 1000 + micros;
};

const DAY_US = 86_400_000_000;

/**
 * Moves a yearless stamp into the year of `referenceUs`, the newest wall-clock
 * time in the same archive. A stamp that would land more than a day after the
 * reference belongs to the year before: the log cannot postdate its capture.
 */
export const resolveYearless = (placeholderUs: number, referenceUs: number): number => {
  const placeholder = new Date(placeholderUs / 1000);
  const year = new Date(referenceUs / 1000).getUTCFullYear();
  const shift = (target: number) => {
    const moved = new Date(placeholder.getTime());
    moved.setUTCFullYear(target);
    return moved.getTime() * 1000 + (placeholderUs % 1000);
  };
  const candidate = shift(year);
  return candidate - referenceUs > DAY_US ? shift(year - 1) : candidate;
};

export interface BootAnchor {
  /** Epoch microseconds of monotonic time zero. */
  bootEpochUs: number;
  sampleCount: number;
}

// syslog relays the kernel ring buffer, so its lines carry both clocks:
// "2026-08-31T06:17:23.867811Z INFO kernel: [    0.000000] Booting Linux ..."
const KERNEL_RELAY = /^(\S+)\s+\w+\s+kernel:\s+\[\s*(\d+\.\d+)\]/;

// rsyslogd stamps the whole boot backlog with its own start time, which places
// boot up to a few seconds too late. Measured on real feedback archives, those
// early samples spread the estimate by ~3.6s while everything past this cutoff
// agrees to a few milliseconds.
const BACKLOG_CUTOFF_US = 10 * 1_000_000;
const MIN_LATE_SAMPLES = 10;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

/**
 * Works out when monotonic zero happened in wall-clock terms, so kernel logs
 * can share a timeline with everything else. Returns null when the syslog
 * section carries no relayed kernel lines to pair the two clocks with.
 */
export const deriveBootAnchor = (syslogContent: string): BootAnchor | null => {
  const all: number[] = [];
  const late: number[] = [];

  for (const line of syslogContent.split("\n")) {
    const match = KERNEL_RELAY.exec(line);
    if (!match) continue;

    const wallUs = parseWallTimestamp(match[1]);
    if (wallUs === null) continue;

    const monoUs = monotonicSecondsToMicros(match[2]);
    const estimate = wallUs - monoUs;

    all.push(estimate);
    if (monoUs > BACKLOG_CUTOFF_US) late.push(estimate);
  }

  // The median resists the stragglers that syslog writes late; a message can
  // only ever be relayed after the fact, never before it happened.
  const samples = late.length >= MIN_LATE_SAMPLES ? late : all;
  if (samples.length === 0) return null;

  return { bootEpochUs: Math.round(median(samples)), sampleCount: samples.length };
};
