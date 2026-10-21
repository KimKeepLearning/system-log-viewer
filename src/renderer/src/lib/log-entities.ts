import { sectionNameOf } from "./log-domains";
import { AnalyzedLog } from "./log-rules";

/**
 * Chrome's redaction tool numbers each distinct value once per report, so
 * "(MAC OUI=60:22:32 IFACE=5)" is the same access point on every line it
 * appears on. That makes the tokens followable: one click lists everything that
 * touched one address, account or device.
 *
 * Aliases from components/feedback/redaction_tool/redaction_tool.cc.
 */
const ALIASES = [
  "URL",
  "email",
  "IPv4",
  "IPv6",
  "UUID",
  "Serial",
  "SSID",
  "SSIDHex",
  "Volume Label",
  "GAIA",
  "Crash ID",
  "CellID",
  "LocAC",
  "IPP Address",
  "Memory Dump",
  "PSM ID",
  "UID",
  "Bluetooth HID Device",
  "CREDITCARD",
  "IBAN"
];

const alias = ALIASES.map((name) => name.replace(/ /g, "\\s")).join("|");

export const redactionTokenPattern = (): RegExp =>
  new RegExp(
    `\\((?:${alias}): \\d+\\)|\\(MAC OUI=[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){2} IFACE=\\d+\\)|\\(HASH:[0-9a-fA-F]{4} \\d+\\)`,
    "g"
  );

export const entityKind = (token: string): string => {
  if (token.startsWith("(MAC")) return "MAC";
  if (token.startsWith("(HASH")) return "hash";
  return token.slice(1, token.indexOf(":"));
};

export interface Entity {
  token: string;
  kind: string;
  count: number;
  sections: string[];
  sampleIndex: number;
  /**
   * Every occurrence is on the wall clock. Merge drops untimed lines, and many
   * tokens live in dumps that have none (network_services, UI Hierarchy), so
   * only these can be shown merged.
   */
  timed: boolean;
}

const MAX_ENTITIES = 300;

export const collectEntities = (logs: AnalyzedLog[]): Entity[] => {
  const pattern = redactionTokenPattern();
  const entities = new Map<string, Entity>();

  for (let index = 0; index < logs.length; index++) {
    const message = logs[index].message;
    if (!message || !message.includes("(")) continue;

    pattern.lastIndex = 0;
    for (const match of message.matchAll(pattern)) {
      const token = match[0];
      const section = sectionNameOf(logs[index].sourceFile);
      const timed = logs[index].tsKind === "wall" && typeof logs[index].ts === "number";
      const entity = entities.get(token);
      if (entity) {
        entity.count++;
        entity.timed &&= timed;
        if (!entity.sections.includes(section) && entity.sections.length < 6) {
          entity.sections.push(section);
        }
      } else {
        entities.set(token, {
          token,
          kind: entityKind(token),
          count: 1,
          sections: [section],
          sampleIndex: index,
          timed
        });
      }
    }
  }

  return [...entities.values()].sort((a, b) => b.count - a.count).slice(0, MAX_ENTITIES);
};
