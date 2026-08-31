/**
 * A system_logs.txt holds well over a hundred sections listed in the order the
 * dump happened to write them, which makes the sidebar a wall of names. Sorting
 * them into domains gives the list a shape a person can scan.
 *
 * The patterns were written against the section names in real ChromeOS feedback
 * archives; anything unmatched falls into "Other" rather than being hidden.
 */
export const LOG_DOMAINS = [
  "Chrome & UI",
  "Kernel & Boot",
  "Network",
  "Audio",
  "Bluetooth",
  "Power",
  "Graphics",
  "Storage & Memory",
  "Hardware",
  "Processes",
  "App logs",
  "Other"
] as const;

export type LogDomain = (typeof LOG_DOMAINS)[number];

// First match wins, so the more specific patterns come first. Kernel is matched
// before Processes, for instance, because "threads" would otherwise capture
// kernel thread sections.
const DOMAIN_PATTERNS: [LogDomain, RegExp][] = [
  [
    "Chrome & UI",
    /^(chrome_|ui_log|ui_device_data_manager|UI Hierarchy|extensions|ozone_|virtual_keyboard|input_devices)/i
  ],
  [
    "Kernel & Boot",
    /^(dmesg|syslog|upstart|bootstat|interrupts|lsmod|slabinfo|buddyinfo|pagetypeinfo|vmstat|psi_|vmlog|env|audit_log)/i
  ],
  ["Network", /^(netlog|network|ifconfig|routes|iw_list|traffic-counters|tlsdate|mm-|shill)/i],
  ["Audio", /^(cras|alsa|audio_)/i],
  ["Bluetooth", /^(bluetooth|btmon|floss)/i],
  ["Power", /^(powerd|power_supply|wakeup_sources|pchg_)/i],
  ["Graphics", /^(drm_|modetest|framebuffer|edid|mali_|hdmi|synthesize|font_info)/i],
  [
    "Storage & Memory",
    /(disk|lsblk|blkid|^lvs|^pvs|mem_|meminfo|swap_|storage_|folder_size|chromeos-pgmem)/i
  ],
  [
    "Hardware",
    /^(bios_|cpuinfo|ec_info|cbi_info|crosid|hardware_class|vpd_|sensor_info|lspci|lsusb|cros_fp|cros_tp|amd_stb|fwupd|hwsec|dbus_|lpstat|mountinfo|android_app_storage)/i
  ],
  ["Processes", /^(ps$|threads|top )/i],
  ["App logs", /(vibe-service|crosvm|update_engine|device_event_log|system_log_stats|LOGDATE)/i]
];

const cache = new Map<string, LogDomain>();

/** `sectionKey` is the display name, i.e. the part after "file::". */
export const classifySection = (sectionKey: string): LogDomain => {
  const cached = cache.get(sectionKey);
  if (cached) return cached;

  let domain: LogDomain = "Other";
  for (const [candidate, pattern] of DOMAIN_PATTERNS) {
    if (pattern.test(sectionKey)) {
      domain = candidate;
      break;
    }
  }

  cache.set(sectionKey, domain);
  return domain;
};

export const sectionNameOf = (compositeKey: string): string =>
  compositeKey.split("::").slice(1).join("::") || compositeKey;

/**
 * Files carry their whole path inside the archive, which is unambiguous but
 * unreadable: three entries from one feedback zip all begin with the same
 * twenty-two character name and differ only at the end, exactly where
 * truncation cuts. Labels are the file name alone, with just enough of the
 * parent path to separate ones that would otherwise read the same.
 */
export const shortFileLabels = (names: string[]): Map<string, string> => {
  const basenameOf = (name: string) => name.split("/").pop() ?? name;

  const collisions = new Map<string, number>();
  for (const name of names) {
    const base = basenameOf(name);
    collisions.set(base, (collisions.get(base) ?? 0) + 1);
  }

  const labels = new Map<string, string>();
  for (const name of names) {
    const segments = name.split("/");
    const base = segments[segments.length - 1];
    const needsParent = (collisions.get(base) ?? 0) > 1 && segments.length > 1;
    labels.set(name, needsParent ? `${segments[segments.length - 2]}/${base}` : base);
  }
  return labels;
};
