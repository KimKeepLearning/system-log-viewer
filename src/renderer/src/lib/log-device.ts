import { extractSingleLineFields } from "./log-parser";
import { SectionMap, sectionText } from "./log-sections";

/**
 * What the device is, gathered from the twenty-odd sections that each hold one
 * piece of it. Each card keeps its section so the full dump is one click away,
 * and the lines are short enough for Compare to diff two devices.
 */
export interface DeviceCard {
  title: string;
  section: string | null;
  lines: string[];
}

const SYSTEM_FIELDS = [
  "CHROME VERSION",
  "CHROMEOS_RELEASE_VERSION",
  "CHROMEOS_RELEASE_BOARD",
  "CHROMEOS_RELEASE_TRACK",
  "CHROMEOS_FIRMWARE_VERSION",
  "HWID",
  "CHROMEOS_ARC_STATUS",
  "ENTERPRISE_ENROLLED",
  "FREE_DISK_SPACE",
  "monitor_info"
];

const nonEmptyLines = (text: string, limit: number): string[] =>
  text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, limit);

const matches = (text: string, pattern: RegExp, limit = 40): string[] => {
  const result: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = (match[1] ?? match[0]).trim();
    if (value && !result.includes(value)) result.push(value);
    if (result.length >= limit) break;
  }
  return result;
};

const cpuSummary = (cpuinfo: string): string[] => {
  if (!cpuinfo) return [];
  const processors = (cpuinfo.match(/^processor\s*:/gm) ?? []).length;
  const model = cpuinfo.match(/^model name\s*:\s*(.+)$/m)?.[1];
  const parts = [...new Set(cpuinfo.match(/^CPU part\s*:\s*(\S+)$/gm) ?? [])].map((line) =>
    line.split(":")[1].trim()
  );
  return [
    `${processors} logical CPUs`,
    model ?? (parts.length > 0 ? `ARM parts ${parts.join(", ")}` : "")
  ].filter(Boolean);
};

// ectool and vpd fail on boards without a ChromeOS EC or VPD; their errors are
// not facts about the device.
const NOT_A_FACT =
  /^\+ |Cannot find I2C adapter|Unable to establish host communication|Couldn't find EC|not supported|Error opening directory|VPD is invalid|ERROR: Failed to read|^\[\d+\]$|^\S[^|]*\|\s*$/;

/** A tarball names the same dumps with a .txt suffix. */
const textOf = (sections: SectionMap, key: string): { key: string; text: string } => {
  for (const candidate of [key, `${key}.txt`]) {
    const text = sectionText(sections, candidate);
    if (text) return { key: candidate, text };
  }
  return { key, text: "" };
};

const RAW_CARDS: { title: string; section: string; limit: number }[] = [
  { title: "Type-C", section: "typec_connector_class", limit: 20 },
  { title: "BIOS", section: "bios_info", limit: 12 },
  { title: "EC", section: "ec_info", limit: 12 },
  { title: "VPD", section: "vpd_2.0", limit: 20 },
  { title: "CrOS ID", section: "crosid", limit: 8 },
  { title: "CBI", section: "cbi_info", limit: 12 },
  { title: "Storage", section: "storage_info", limit: 16 }
];

export const deviceCards = (content: string, sections: SectionMap): DeviceCard[] => {
  const cards: DeviceCard[] = [];

  const fields = new Map(extractSingleLineFields(content).map((field) => [field.key, field.value]));
  const system = SYSTEM_FIELDS.filter((key) => fields.get(key)).map(
    (key) => `${key}: ${fields.get(key)}`
  );
  if (system.length > 0) cards.push({ title: "System", section: null, lines: system });

  const meminfo = sectionText(sections, "meminfo").match(/^MemTotal:\s+(\d+) kB/m);
  const cpu = [
    ...cpuSummary(sectionText(sections, "cpuinfo")),
    ...(meminfo ? [`${(Number(meminfo[1]) / 1024 / 1024).toFixed(1)} GiB RAM`] : [])
  ];
  if (cpu.length > 0) cards.push({ title: "CPU & memory", section: "cpuinfo", lines: cpu });

  // `lsusb` here is the tree form, where the "ID vid:pid name" line follows each port.
  const usb = matches(
    sectionText(sections, "lsusb"),
    /^\s*ID ([0-9a-f]{4}:[0-9a-f]{4}.*)$/gm
  ).filter((line) => !/ root hub$/.test(line));
  if (usb.length > 0) cards.push({ title: "USB devices", section: "lsusb", lines: usb });

  const edid = sectionText(sections, "edid-decode");
  const displays = matches(
    edid,
    /^\s*((?:Display Product Name|Manufacturer|Model|Made in|DTD 1):.*)$/gm,
    20
  ).map((line) => line.replace(/\s+/g, " "));
  if (displays.length > 0)
    cards.push({ title: "Displays", section: "edid-decode", lines: displays });

  const inputs = matches(sectionText(sections, "input_devices"), /^N: Name="(.*)"$/gm);
  if (inputs.length > 0)
    cards.push({ title: "Input devices", section: "input_devices", lines: inputs });

  for (const { title, section, limit } of RAW_CARDS) {
    const { key, text } = textOf(sections, section);
    const lines = nonEmptyLines(text, 400)
      .filter((line) => !NOT_A_FACT.test(line))
      .slice(0, limit);
    if (lines.length > 0) cards.push({ title, section: key, lines });
  }

  return cards;
};
