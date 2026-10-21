import { SectionMap, sectionText } from "./log-sections";

/**
 * shill's own view of the network, from the network_services and
 * network_devices dumps: which service was connected, how strong it was, and
 * what shill recorded as the last failure. The text log only ever shows the
 * transitions; this is the state they led to.
 */
export interface NetworkService {
  path: string;
  name: string;
  type: string;
  state: string;
  strength: number | null;
  error: string;
  security: string;
  frequency: number | null;
  bssid: string;
  disconnects: number;
  misconnects: number;
}

export interface NetworkDevice {
  path: string;
  interface: string;
  type: string;
  powered: boolean | null;
}

type Properties = Record<string, unknown>;

const parseDump = (raw: string): Record<string, Properties> => {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, Properties>) : {};
  } catch {
    return {};
  }
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const number = (value: unknown): number | null => (typeof value === "number" ? value : null);
const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

const STATE_ORDER = ["online", "connected", "ready", "portal", "no-connectivity", "redirect-found"];

export const parseNetworkServices = (raw: string): NetworkService[] =>
  Object.entries(parseDump(raw))
    .map(([path, properties]) => ({
      path,
      name: text(properties.Name),
      type: text(properties.Type),
      state: text(properties.State),
      strength: number(properties.Strength),
      error: text(properties.Error),
      security: text(properties.SecurityClass ?? properties.Security),
      frequency: number(properties["WiFi.Frequency"]),
      bssid: text(properties["WiFi.BSSID"]),
      disconnects: count(properties["Diagnostics.Disconnects"]),
      misconnects: count(properties["Diagnostics.Misconnects"])
    }))
    .sort((a, b) => {
      const rank = (state: string) => {
        const index = STATE_ORDER.indexOf(state);
        return index === -1 ? STATE_ORDER.length : index;
      };
      return rank(a.state) - rank(b.state);
    });

export const parseNetworkDevices = (raw: string): NetworkDevice[] =>
  Object.entries(parseDump(raw)).map(([path, properties]) => ({
    path,
    interface: text(properties.Interface),
    type: text(properties.Type),
    powered: typeof properties.Powered === "boolean" ? properties.Powered : null
  }));

/**
 * debugd's `croslog --grep … | wc -l` counters. croslog's own warnings land in
 * the same capture, so the count is the last line that is only a number.
 */
const COUNTER_SECTIONS = [
  "wifi_connection_attempts",
  "wifi_connection_timeouts",
  "wifi_driver_errors_count",
  "iwlwifi_sysasserts_count",
  "bt_usb_disconnects"
];

export interface NetworkSnapshot {
  services: NetworkService[];
  devices: NetworkDevice[];
  counters: { key: string; value: string }[];
}

export const networkSnapshot = (sections: SectionMap): NetworkSnapshot => ({
  services: parseNetworkServices(sectionText(sections, "network_services")),
  devices: parseNetworkDevices(sectionText(sections, "network_devices")),
  counters: COUNTER_SECTIONS.flatMap((key) => {
    const raw = sectionText(sections, key);
    const numbers = [...raw.matchAll(/^\s*(\d+)\s*$/gm)];
    if (numbers.length > 0) return [{ key, value: numbers[numbers.length - 1][1] }];
    const short = raw.trim();
    return short && short.length <= 120 && !short.includes("\n") ? [{ key, value: short }] : [];
  })
});
