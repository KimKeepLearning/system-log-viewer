import { describe, expect, it } from "vitest";
import { createRedactor } from "../log-redact";

describe("createRedactor", () => {
  it("replaces each identifying value with a placeholder that is stable within a run", () => {
    const redact = createRedactor();

    expect(redact("signed in as alice@example.com from 10.0.0.12")).toBe(
      "signed in as <email-1> from <ip-1>"
    );
    expect(redact("alice@example.com again, bob@example.com new")).toBe(
      "<email-1> again, <email-2> new"
    );
    expect(redact("/home/chronos/u-0123456789abcdef0123456789abcdef01234567/Downloads")).toBe(
      "/home/chronos/u-<hash-1>/Downloads"
    );
    expect(redact("Connected to SSID: HomeWifi, signal -40")).toBe(
      "Connected to SSID: <ssid-1>, signal -40"
    );
    expect(redact("wlan0 aa:bb:cc:dd:ee:ff up")).toBe("wlan0 <mac-1> up");
    expect(redact("GET https://api.example.com/v1/user?token=abc&id=7 200")).toBe(
      "GET https://api.example.com/v1/user<url-query-1> 200"
    );
    expect(redact("serial_number=PF3ABCD1")).toBe("serial_number=<serial-1>");
  });

  it("leaves what only looks like an address alone", () => {
    const redact = createRedactor();
    const untouched = [
      "Chrome/128.0.6613.137 started",
      "CHROMEOS_RELEASE_VERSION=16295.0.0",
      "2026-08-31T06:17:25.092359Z ash::Shell cc::LayerTreeHost ready",
      "listening on 127.0.0.1:8080",
      "[../../chrome/browser/ui/views/frame/browser_view.cc:1234]"
    ];
    for (const line of untouched) expect(redact(line)).toBe(line);
  });
});
