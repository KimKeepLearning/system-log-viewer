import { useMemo, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { Input } from "@renderer/components/ui/input";
import { ScrollArea } from "@renderer/components/ui/scroll-area";
import { sectionFilterAtom, sectionStatsAtom } from "@renderer/lib/atom";
import { classifySection, LOG_DOMAINS, LogDomain, sectionNameOf } from "@renderer/lib/log-domains";
import { SectionStats } from "@renderer/lib/typings";

interface FileSidebarProps {
  files: string[];
  logStructure: Record<string, string[]>;
  selectedFileName: string | null;
  activeFile: string | null;
  deviceInfo: { board?: string; version?: string; arcStatus?: string };
  onSelectFile: (fileName: string) => void;
  onScrollToSection: (key: string) => void;
}

interface SectionEntry {
  key: string;
  name: string;
  stats?: SectionStats;
}

const EMPTY_STATS: SectionStats = {
  lines: 0,
  errors: 0,
  warnings: 0,
  firstTs: null,
  lastTs: null
};

const compact = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value);

const SectionRow = ({
  entry,
  isActive,
  isPinned,
  onScrollToSection,
  onTogglePin
}: {
  entry: SectionEntry;
  isActive: boolean;
  isPinned: boolean;
  onScrollToSection: (key: string) => void;
  onTogglePin: (key: string) => void;
}) => {
  const stats = entry.stats ?? EMPTY_STATS;

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded px-1.5 py-1 cursor-pointer transition-colors",
        isActive ? "bg-primary/10 text-primary" : "hover:bg-muted/60",
        isPinned && !isActive && "bg-muted/40"
      )}
      onClick={() => onScrollToSection(entry.key)}
      title={`${entry.name} — ${stats.lines.toLocaleString()} lines`}
    >
      {/* A section with errors earns a mark; everything else stays quiet. */}
      <span
        className={cn(
          "size-1.5 rounded-full shrink-0",
          stats.errors > 0 ? "bg-red-500" : stats.warnings > 0 ? "bg-amber-500" : "bg-transparent"
        )}
      />
      <span className={cn("text-xs truncate flex-1 min-w-0", isActive && "font-medium")}>
        {entry.name}
      </span>
      {stats.errors > 0 && (
        <span className="text-[10px] tabular-nums text-red-500 font-medium">{stats.errors}</span>
      )}
      <span className="text-[10px] tabular-nums text-muted-foreground/60 w-8 text-right shrink-0">
        {compact(stats.lines)}
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onTogglePin(entry.key);
        }}
        className={cn(
          "size-3.5 rounded-sm shrink-0 border text-[9px] leading-none flex items-center justify-center transition-opacity",
          isPinned
            ? "bg-primary border-primary text-primary-foreground"
            : "border-border opacity-0 group-hover:opacity-100 hover:border-primary"
        )}
        title={
          isPinned ? "Stop limiting the view to this section" : "Limit the view to this section"
        }
      >
        {isPinned ? "✓" : ""}
      </button>
    </div>
  );
};

export const FileSidebar = ({
  files,
  logStructure,
  selectedFileName,
  activeFile,
  deviceInfo,
  onSelectFile,
  onScrollToSection
}: FileSidebarProps) => {
  const stats = useAtomValue(sectionStatsAtom);
  const [sectionFilter, setSectionFilter] = useAtom(sectionFilterAtom);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hideEmpty, setHideEmpty] = useState(false);

  const grouped = useMemo(() => {
    const keys = selectedFileName ? (logStructure[selectedFileName] ?? []) : [];
    const needle = query.trim().toLowerCase();

    const byDomain = new Map<LogDomain, SectionEntry[]>();
    for (const key of keys) {
      const name = sectionNameOf(key);
      if (needle && !name.toLowerCase().includes(needle)) continue;

      const entry: SectionEntry = { key, name, stats: stats[key] };
      if (hideEmpty && (entry.stats?.lines ?? 0) === 0) continue;

      const domain = classifySection(name);
      const bucket = byDomain.get(domain);
      if (bucket) bucket.push(entry);
      else byDomain.set(domain, [entry]);
    }

    // Keep the declared domain order rather than insertion order, so the list
    // sits in the same place between files.
    return LOG_DOMAINS.filter((domain) => byDomain.has(domain)).map((domain) => ({
      domain,
      entries: byDomain.get(domain)!.sort((a, b) => a.name.localeCompare(b.name))
    }));
  }, [logStructure, selectedFileName, stats, query, hideEmpty]);

  const totalShown = grouped.reduce((sum, group) => sum + group.entries.length, 0);

  const togglePin = (key: string) => {
    const next = new Set(sectionFilter);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSectionFilter(next);
  };

  return (
    <div className="w-72 border-r bg-muted/20 shrink-0 flex flex-col min-h-0">
      <div className="px-2.5 py-2 border-b flex flex-col gap-0.5">
        <div className="text-sm font-semibold truncate" title={deviceInfo.board}>
          {deviceInfo.board && deviceInfo.board !== "unknown" ? deviceInfo.board : "Unknown board"}
        </div>
        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 tabular-nums">
          <span>{deviceInfo.version ?? "unknown"}</span>
          <span className="opacity-40">·</span>
          <span>ARC {deviceInfo.arcStatus ?? "unknown"}</span>
        </div>
      </div>

      {files.length > 1 && (
        <div className="p-2 border-b flex flex-col gap-0.5">
          {files.map((fileName) => (
            <button
              key={fileName}
              type="button"
              onClick={() => onSelectFile(fileName)}
              className={cn(
                "text-xs text-left truncate rounded px-2 py-1 transition-colors",
                fileName === selectedFileName
                  ? "bg-primary/10 text-primary font-medium"
                  : "hover:bg-muted text-muted-foreground"
              )}
              title={fileName}
            >
              {fileName}
            </button>
          ))}
        </div>
      )}

      <div className="p-2 flex flex-col gap-1.5 border-b">
        <div className="relative flex items-center">
          <Search className="absolute left-2 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a section..."
            className="pl-7 pr-7 h-7 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <button
            type="button"
            className="hover:text-foreground transition-colors"
            onClick={() => setHideEmpty(!hideEmpty)}
          >
            {hideEmpty ? "◉" : "○"} Hide empty
          </button>
          {sectionFilter.size > 0 ? (
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => setSectionFilter(new Set())}
            >
              Showing {sectionFilter.size} pinned — reset
            </button>
          ) : (
            <span className="tabular-nums">{totalShown} sections</span>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0 scrollbar-container">
        <div className="p-1.5 flex flex-col gap-1">
          {grouped.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">No section matches.</p>
          )}

          {grouped.map((group) => {
            const isCollapsed = collapsed.has(group.domain);
            const errors = group.entries.reduce((sum, e) => sum + (e.stats?.errors ?? 0), 0);

            return (
              <div key={group.domain}>
                <button
                  type="button"
                  onClick={() => {
                    const next = new Set(collapsed);
                    if (next.has(group.domain)) next.delete(group.domain);
                    else next.add(group.domain);
                    setCollapsed(next);
                  }}
                  className="w-full flex items-center gap-1 px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
                >
                  {isCollapsed ? (
                    <ChevronRight className="size-3" />
                  ) : (
                    <ChevronDown className="size-3" />
                  )}
                  <span className="flex-1 text-left">{group.domain}</span>
                  {errors > 0 && (
                    <span className="text-red-500 tabular-nums normal-case">{errors}</span>
                  )}
                  <span className="tabular-nums opacity-60 normal-case">
                    {group.entries.length}
                  </span>
                </button>

                {!isCollapsed && (
                  <div className="flex flex-col">
                    {group.entries.map((entry) => (
                      <SectionRow
                        key={entry.key}
                        entry={entry}
                        isActive={activeFile === entry.key}
                        isPinned={sectionFilter.has(entry.key)}
                        onScrollToSection={onScrollToSection}
                        onTogglePin={togglePin}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};
