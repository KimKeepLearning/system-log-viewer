/** Verbatim fragments from ChromeOS feedback archives, trimmed to a few lines. */

export const CHROME_LINES = [
  "2026-08-31T06:17:25.092359Z WARNING chrome[1016:1016]: [../../chrome/browser/ui/views/frame/browser_view.cc:1234] Widget not ready",
  '2026-08-31T06:17:25.092999Z INFO chrome[1016:1016]: "[AI Subscription] user belongs to 4 workspaces'
];

export const KERNEL_LINES = [
  "<6>[    0.606417] pcieport 0000:00:1c.0: AER: Corrected error received",
  "[   12.345678] cros-ec-spi spi0.0: EC communication failed"
];

export const DEVICE_EVENT_LINE =
  "2026-08-30T23:17:31.303993-07:00 USB: ERROR chrome[1016]: usb_service_linux.cc:255 Failed to open device";

export const SERVICE_LINE =
  "[2026-08-21 23:16:25.285] [INFO] [service::usbfs_client::handler:293] claimed interface 1";

export const CRAS_LINE =
  "2026-01-15T17:11:47.912820765 cras atlog  READ_AUDIO_TSTAMP dev:3 tstamp:123";

export const AUDIT_LINE =
  "WARNING audit_log_filter: [../../debugd/src/helpers/audit_log_filter.cc:57] Failed to parse rule.";

/**
 * Lines from sections that are command output, not logs. The standard pattern
 * used to accept these and hand each a timestamp made of its first token.
 */
export const NON_LOG_LINES = [
  "chronos 1234 /usr/bin/vibe_service: running",
  "eth0 Link encap:Ethernet  HWaddr 00:11:22:33:44:55",
  "tmpfs on /run type tmpfs (rw,nosuid,nodev,seclabel,mode=755)"
];

export const SYSTEM_LOGS_SAMPLE = `CHROMEOS_RELEASE_BOARD=orthrus
CHROMEOS_RELEASE_VERSION=16295.0.0
CHROMEOS_ARC_STATUS=enabled
HWID=ORTHRUS-ABCD A1B-C2D
chrome_user_log=<multiline>
---------- START ----------
2026-08-31T06:17:25.092359Z ERROR chrome[1016:1016]: [../../a/b.cc:1] boom
2026-08-31T06:17:26.000000Z INFO chrome[1016:1016]: fine
---------- END ----------
Profile[0] login_times=<multiline>
---------- START ----------
2026-08-31T06:17:27.000000Z INFO session_manager[900]: logged in
---------- END ----------
FREE_DISK_SPACE=1234
`;

// syslog relays kernel lines with both clocks attached, which is what pins
// monotonic zero to the wall clock.
export const SYSLOG_SAMPLE = Array.from({ length: 12 }, (_, index) => {
  const monotonic = 20 + index;
  const seconds = (10 + index).toString().padStart(2, "0");
  return `2026-08-31T06:18:${seconds}.000000Z INFO kernel: [   ${monotonic}.000000] something happened`;
}).join("\n");
