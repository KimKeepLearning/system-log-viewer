import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { Input } from "@renderer/components/ui/input";
import type { CrashKind, CrashRecord } from "@renderer/lib/log-crashes";
import type { MemorySnapshot } from "@renderer/lib/log-memory";
import type { ServiceHealth } from "@renderer/lib/log-services";
import type { NetworkSnapshot } from "@renderer/lib/log-network";
import type { DeviceCard } from "@renderer/lib/log-device";
import type { Entity } from "@renderer/lib/log-entities";
import { summariseSeries, type SamplerSeries } from "@renderer/lib/log-tables";
import { ExtendedLog } from "../types";

const clock = (micros: number | null): string =>
  micros === null ? "—" : new Date(micros / 1000).toISOString().slice(0, 19).replace("T", " ");

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm text-muted-foreground py-8 text-center">{children}</p>
);

const Heading = ({ children }: { children: React.ReactNode }) => (
  <h4 className="text-xs font-semibold mb-1">{children}</h4>
);

const KIND_STYLE: Record<CrashKind, string> = {
  process: "bg-red-500/15 text-red-600 dark:text-red-400",
  service: "bg-red-500/15 text-red-600 dark:text-red-400",
  kernel: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400",
  firmware: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400",
  gpu: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  android: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
};

export function CrashesTab({
  crashes,
  logs,
  onJumpToLog,
  onShowSection
}: {
  crashes: CrashRecord[];
  logs: ExtendedLog[];
  onJumpToLog: (log: ExtendedLog) => void;
  onShowSection: (section: string) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);

  if (crashes.length === 0) {
    return (
      <Empty>
        No crash in this archive: no crash_reporter, segfault, ANR or panic line, and no dump
        section with anything in it.
      </Empty>
    );
  }

  return (
    <div className="flex flex-col">
      <p className="text-xs text-muted-foreground mb-2">
        From crash_reporter, kernel, upstart and logcat lines, the pstore console, EC panic info and
        crash .meta files. A feedback report carries no minidumps; a /var/log tarball does.
      </p>
      {crashes.map((crash, index) => (
        <div key={index} className="border-b border-border/40 min-w-0">
          <button
            type="button"
            onClick={() => {
              if (crash.logIndex !== undefined) onJumpToLog(logs[crash.logIndex]);
              else if (crash.raw) setOpen(open === index ? null : index);
              else onShowSection(crash.section);
            }}
            className="w-full text-left flex items-baseline gap-2 py-1 hover:bg-muted/60 transition-colors min-w-0"
          >
            <span className="text-[11px] tabular-nums text-muted-foreground w-36 shrink-0">
              {clock(crash.ts)}
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0 w-16 text-center",
                KIND_STYLE[crash.kind]
              )}
            >
              {crash.kind}
            </span>
            <span className="text-xs font-medium truncate min-w-0">{crash.title}</span>
            <span className="text-[11px] font-mono text-muted-foreground truncate flex-1 min-w-0">
              {crash.detail}
            </span>
            <span className="text-[10px] text-muted-foreground truncate w-32 shrink-0 text-right">
              {crash.section}
            </span>
            {crash.raw && crash.logIndex === undefined && (
              <ChevronRight
                className={cn(
                  "size-3 shrink-0 transition-transform",
                  open === index && "rotate-90"
                )}
              />
            )}
          </button>
          {open === index && crash.raw && (
            <div className="mb-2">
              <pre className="text-[11px] font-mono bg-muted/40 rounded p-2 max-h-72 overflow-auto whitespace-pre-wrap break-all select-text">
                {crash.raw}
              </pre>
              <button
                type="button"
                onClick={() => onShowSection(crash.section)}
                className="text-[10px] text-primary hover:underline mt-1"
              >
                Open section in the log
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const SPARK_COLUMNS: { column: string; label: string; format: (value: number) => string }[] = [
  { column: "cpuusage", label: "CPU usage", format: (value) => `${(value * 100).toFixed(0)}%` },
  {
    column: "pgmajfault",
    label: "Major page faults / interval",
    format: (value) => value.toFixed(0)
  },
  { column: "pswpin", label: "Swap-in pages / interval", format: (value) => value.toFixed(0) },
  { column: "pswpout", label: "Swap-out pages / interval", format: (value) => value.toFixed(0) }
];

const SPARK_WIDTH = 600;
const SPARK_HEIGHT = 40;

function Sparkline({
  series,
  column,
  label,
  format,
  onShowTime
}: {
  series: SamplerSeries;
  column: string;
  label: string;
  format: (value: number) => string;
  onShowTime: (ts: number) => void;
}) {
  const stat = useMemo(() => summariseSeries(series, column), [series, column]);
  const path = useMemo(() => {
    if (!stat) return "";
    const first = series.rows[0].ts;
    const span = Math.max(1, series.rows[series.rows.length - 1].ts - first);
    const range = Math.max(stat.max, 1e-9);
    return series.rows
      .filter((row) => typeof row.values[column] === "number")
      .map((row, index) => {
        const x = ((row.ts - first) / span) * SPARK_WIDTH;
        const y = SPARK_HEIGHT - (row.values[column] / range) * (SPARK_HEIGHT - 2) - 1;
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [series, column, stat]);

  if (!stat) return null;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          mean {format(stat.mean)} · max {format(stat.max)}
        </span>
        <button
          type="button"
          onClick={() => onShowTime(stat.peakTs)}
          className="ml-auto text-[10px] text-primary hover:underline tabular-nums"
          title="Show the log around the peak"
        >
          peak at {clock(stat.peakTs).slice(5)}
        </button>
      </div>
      <svg
        viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
        preserveAspectRatio="none"
        className="w-full h-10 rounded bg-muted/40"
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          className="text-primary"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

const MEMINFO_ROWS: [string, string][] = [
  ["MemTotal", "Total"],
  ["MemAvailable", "Available"],
  ["SwapTotal", "Swap total"],
  ["SwapFree", "Swap free"],
  ["Shmem", "Shared"]
];

const gib = (kilobytes: number) => `${(kilobytes / 1024 / 1024).toFixed(2)} GiB`;

export function MemoryTab({
  memory,
  onShowTime
}: {
  memory: MemorySnapshot;
  onShowTime: (ts: number) => void;
}) {
  const { vmlog, processes, meminfo, pressure } = memory;
  const hasMeminfo = MEMINFO_ROWS.some(([key]) => key in meminfo);

  if (!vmlog && processes.length === 0 && !hasMeminfo && pressure.length === 0) {
    return <Empty>No vmlog, mem_usage, meminfo or PSI section in this archive.</Empty>;
  }

  return (
    <div className="flex flex-col gap-4">
      {vmlog && (
        <div className="flex flex-col gap-2">
          <Heading>
            vmlog · {vmlog.rows.length.toLocaleString()} samples, {clock(vmlog.rows[0].ts)} →{" "}
            {clock(vmlog.rows[vmlog.rows.length - 1].ts)}
          </Heading>
          {SPARK_COLUMNS.filter(({ column }) => vmlog.columns.includes(column)).map((spark) => (
            <Sparkline key={spark.column} series={vmlog} {...spark} onShowTime={onShowTime} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {hasMeminfo && (
          <div>
            <Heading>meminfo</Heading>
            {MEMINFO_ROWS.filter(([key]) => key in meminfo).map(([key, label]) => (
              <div key={key} className="flex text-xs py-0.5 border-b border-border/40">
                <span className="flex-1">{label}</span>
                <span className="tabular-nums">{gib(meminfo[key])}</span>
              </div>
            ))}
          </div>
        )}

        {pressure.length > 0 && (
          <div>
            <Heading>Pressure stall (avg10 / avg60 / avg300, %)</Heading>
            {pressure.flatMap(({ resource, values }) =>
              values.map((value) => (
                <div
                  key={`${resource}-${value.kind}`}
                  className="flex text-xs py-0.5 border-b border-border/40"
                >
                  <span className="flex-1">
                    {resource} {value.kind}
                  </span>
                  <span
                    className={cn("tabular-nums", value.avg60 >= 10 && "text-red-500 font-medium")}
                  >
                    {value.avg10.toFixed(1)} / {value.avg60.toFixed(1)} / {value.avg300.toFixed(1)}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {processes.length > 0 && (
        <div>
          <Heading>Chrome processes (mem_usage)</Heading>
          {processes.slice(0, 30).map((process, index) => (
            <div
              key={index}
              className="flex items-baseline gap-2 text-xs py-0.5 border-b border-border/40 min-w-0"
            >
              <span className="truncate flex-1 min-w-0 font-mono" title={process.name}>
                {process.name}
              </span>
              <span className="tabular-nums w-16 text-right">{process.megabytes} MB</span>
              <span
                className={cn(
                  "tabular-nums w-28 text-right text-muted-foreground",
                  process.fds / process.fdLimit > 0.8 && "text-red-500"
                )}
              >
                {process.fds} / {process.fdLimit} FDs
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ServicesTab({
  services,
  logs,
  onJumpToLog
}: {
  services: ServiceHealth[];
  logs: ExtendedLog[];
  onJumpToLog: (log: ExtendedLog) => void;
}) {
  if (services.length === 0) {
    return <Empty>Upstart reported no job exiting, respawning or giving up.</Empty>;
  }

  return (
    <div className="flex flex-col">
      <p className="text-xs text-muted-foreground mb-2">
        Upstart jobs that exited non-zero, died on a signal or respawned. Some boot jobs fail on
        purpose; a job that respawns again and again, or that upstart gave up on, is the one to
        read.
      </p>
      <div className="grid grid-cols-[1fr_4rem_4rem_6rem_9rem] gap-x-2 text-[10px] uppercase tracking-wide text-muted-foreground border-b pb-1">
        <span>Job</span>
        <span className="text-right">Exits</span>
        <span className="text-right">Respawns</span>
        <span>Last exit</span>
        <span>Last seen (UTC)</span>
      </div>
      {services.map((service) => (
        <button
          key={service.job}
          type="button"
          onClick={() => onJumpToLog(logs[service.sampleIndex])}
          className="grid grid-cols-[1fr_4rem_4rem_6rem_9rem] gap-x-2 items-baseline text-left text-xs tabular-nums py-1 border-b border-border/40 hover:bg-muted/60 transition-colors"
        >
          <span className="font-mono truncate min-w-0">
            {service.job}
            {service.gaveUp && (
              <span className="ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium font-sans bg-red-500/15 text-red-600 dark:text-red-400">
                gave up
              </span>
            )}
          </span>
          <span className="text-right">{service.failures}</span>
          <span className={cn("text-right", service.respawns >= 3 && "text-red-500 font-medium")}>
            {service.respawns}
          </span>
          <span className="font-mono">{service.lastExit || "—"}</span>
          <span>{clock(service.lastTs)}</span>
        </button>
      ))}
    </div>
  );
}

export function NetworkTab({
  network,
  errors,
  onJumpToLog
}: {
  network: NetworkSnapshot;
  errors: ExtendedLog[];
  onJumpToLog: (log: ExtendedLog) => void;
}) {
  const { services, devices, counters } = network;

  if (
    services.length === 0 &&
    devices.length === 0 &&
    counters.length === 0 &&
    errors.length === 0
  ) {
    return (
      <Empty>No shill dump, Wi-Fi counters or network_event_log errors in this archive.</Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {services.length > 0 && (
        <div>
          <Heading>Services (shill)</Heading>
          <div className="grid grid-cols-[1fr_5rem_7rem_4rem_5rem_6rem_4rem] gap-x-2 text-[10px] uppercase tracking-wide text-muted-foreground border-b pb-1">
            <span>Name</span>
            <span>Type</span>
            <span>State</span>
            <span className="text-right">Signal</span>
            <span className="text-right">MHz</span>
            <span>Last error</span>
            <span className="text-right">Drops</span>
          </div>
          {services.map((service) => (
            <div
              key={service.path}
              className="grid grid-cols-[1fr_5rem_7rem_4rem_5rem_6rem_4rem] gap-x-2 items-baseline text-xs tabular-nums py-1 border-b border-border/40"
              title={[service.path, service.bssid && `BSSID ${service.bssid}`, service.security]
                .filter(Boolean)
                .join(" · ")}
            >
              <span className="font-mono truncate min-w-0">{service.name || service.path}</span>
              <span>{service.type}</span>
              <span
                className={cn(
                  service.state === "online" && "text-emerald-600 dark:text-emerald-400",
                  service.state === "failure" && "text-red-500"
                )}
              >
                {service.state || "—"}
              </span>
              <span className="text-right">{service.strength ?? "—"}</span>
              <span className="text-right">{service.frequency ?? "—"}</span>
              <span
                className={cn(
                  "truncate",
                  service.error && service.error !== "no-failure" && "text-red-500"
                )}
              >
                {service.error || "—"}
              </span>
              <span className="text-right">{service.disconnects + service.misconnects || "—"}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {devices.length > 0 && (
          <div>
            <Heading>Devices</Heading>
            {devices.map((device) => (
              <div
                key={device.path}
                className="flex gap-2 text-xs py-0.5 border-b border-border/40"
              >
                <span className="font-mono flex-1">{device.interface || device.path}</span>
                <span className="text-muted-foreground">{device.type}</span>
                <span className={cn(device.powered === false && "text-red-500")}>
                  {device.powered === null ? "—" : device.powered ? "powered" : "off"}
                </span>
              </div>
            ))}
          </div>
        )}

        {counters.length > 0 && (
          <div>
            <Heading>Counters</Heading>
            {counters.map((counter) => (
              <div
                key={counter.key}
                className="flex gap-2 text-xs py-0.5 border-b border-border/40 min-w-0"
              >
                <span className="font-mono flex-1 truncate">{counter.key}</span>
                <span className="tabular-nums truncate">{counter.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <div>
          <Heading>network_event_log errors ({errors.length})</Heading>
          {errors.slice(-40).map((log) => (
            <button
              key={log.id}
              type="button"
              onClick={() => onJumpToLog(log)}
              className="w-full text-left flex items-baseline gap-2 py-0.5 border-b border-border/40 hover:bg-muted/60 transition-colors min-w-0"
            >
              <span className="text-[11px] tabular-nums text-muted-foreground w-36 shrink-0">
                {clock(typeof log.ts === "number" ? log.ts : null)}
              </span>
              <span className="text-[11px] font-mono truncate flex-1 min-w-0">{log.message}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DeviceTab({
  cards,
  onShowSection
}: {
  cards: DeviceCard[];
  onShowSection: (section: string) => void;
}) {
  if (cards.length === 0) return <Empty>No hardware sections in this archive.</Empty>;

  return (
    <div className="grid grid-cols-2 gap-2">
      {cards.map((card) => (
        <div key={card.title} className="border rounded-md p-2 flex flex-col gap-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold">{card.title}</span>
            {card.section && (
              <button
                type="button"
                onClick={() => onShowSection(card.section!)}
                className="ml-auto text-[10px] text-primary hover:underline font-mono truncate"
              >
                {card.section}
              </button>
            )}
          </div>
          <div className="text-[11px] font-mono text-muted-foreground select-text">
            {card.lines.map((line, index) => (
              <div key={index} className="truncate" title={line}>
                {line}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EntitiesTab({
  entities,
  onSearch
}: {
  entities: Entity[];
  onSearch: (token: string, mergeable: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const kinds = useMemo(() => [...new Set(entities.map((entity) => entity.kind))], [entities]);
  const [kind, setKind] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entities.filter(
      (entity) =>
        (kind === null || entity.kind === kind) &&
        (!needle || entity.token.toLowerCase().includes(needle))
    );
  }, [entities, kind, query]);

  if (entities.length === 0) {
    return (
      <Empty>No redaction tokens: this log was not scrubbed by Chrome&rsquo;s feedback tool.</Empty>
    );
  }

  return (
    <div className="flex flex-col">
      <p className="text-xs text-muted-foreground mb-2">
        Chrome replaced each address, account and identifier with a numbered token that stays the
        same across the whole report. Pick one to filter the log down to every line that mentions
        it.
      </p>
      <div className="flex flex-wrap gap-1 mb-1">
        {[null, ...kinds].map((option) => (
          <button
            key={option ?? "all"}
            type="button"
            onClick={() => setKind(option)}
            className={cn(
              "text-[10px] rounded border px-1.5 py-0.5 transition-colors",
              kind === option
                ? "border-primary text-primary bg-primary/10"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option ?? "all"}
          </button>
        ))}
      </div>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter tokens, e.g. OUI=60:22"
        className="h-7 text-xs mb-1"
      />
      {shown.slice(0, 150).map((entity) => (
        <button
          key={entity.token}
          type="button"
          onClick={() => onSearch(entity.token, entity.timed)}
          className="text-left flex items-baseline gap-2 py-1 border-b border-border/40 hover:bg-muted/60 transition-colors min-w-0"
        >
          <span className="tabular-nums text-xs font-medium w-12 text-right shrink-0">
            {entity.count.toLocaleString()}×
          </span>
          <span className="text-[11px] font-mono truncate flex-1 min-w-0">{entity.token}</span>
          <span className="text-[10px] text-muted-foreground truncate w-48 shrink-0">
            {entity.sections.join(", ")}
          </span>
        </button>
      ))}
    </div>
  );
}
