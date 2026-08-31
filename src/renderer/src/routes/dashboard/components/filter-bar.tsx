import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Check, ChevronDown, Filter, ListFilter, X } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@renderer/components/ui/popover";
import { Input } from "@renderer/components/ui/input";
import { ScrollArea } from "@renderer/components/ui/scroll-area";
import {
  clearFiltersAtom,
  hasActiveFiltersAtom,
  levelFilterAtom,
  LogLevelName,
  processFilterAtom,
  searchModeAtom
} from "@renderer/lib/atom";
import { useState } from "react";

const LEVELS: { name: LogLevelName; label: string; dot: string; active: string }[] = [
  {
    name: "ERROR",
    label: "Error",
    dot: "bg-red-500",
    active: "border-red-500/60 bg-red-500/10 text-red-600 dark:text-red-400"
  },
  {
    name: "WARN",
    label: "Warn",
    dot: "bg-amber-500",
    active: "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400"
  },
  {
    name: "INFO",
    label: "Info",
    dot: "bg-sky-500",
    active: "border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-400"
  },
  {
    name: "DEBUG",
    label: "Debug",
    dot: "bg-zinc-400",
    active: "border-zinc-400/60 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300"
  }
];

const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
};

const compact = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value);

interface FilterBarProps {
  levelCounts: Record<string, number>;
  processes: { name: string; count: number }[];
  visibleCount: number;
  totalCount: number;
}

export const FilterBar = ({ levelCounts, processes, visibleCount, totalCount }: FilterBarProps) => {
  const [levels, setLevels] = useAtom(levelFilterAtom);
  const [processFilter, setProcessFilter] = useAtom(processFilterAtom);
  const [searchMode, setSearchMode] = useAtom(searchModeAtom);
  const hasFilters = useAtomValue(hasActiveFiltersAtom);
  const clearFilters = useSetAtom(clearFiltersAtom);
  const [processQuery, setProcessQuery] = useState("");

  const shownProcesses = processes
    .filter((entry) => entry.name.toLowerCase().includes(processQuery.trim().toLowerCase()))
    .slice(0, 200);

  return (
    <div className="flex flex-1 min-w-0 items-center gap-1.5 flex-wrap">
      {LEVELS.map((level) => {
        const count = levelCounts[level.name] ?? 0;
        const isOn = levels.has(level.name);
        return (
          <button
            key={level.name}
            type="button"
            disabled={count === 0}
            onClick={() => setLevels(toggle(levels, level.name))}
            className={cn(
              "h-6 pl-1.5 pr-2 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 transition-colors",
              "disabled:opacity-35 disabled:cursor-not-allowed",
              isOn
                ? level.active
                : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted"
            )}
            title={`${count.toLocaleString()} ${level.label} lines`}
          >
            <span className={cn("size-1.5 rounded-full", level.dot)} />
            {level.label}
            <span className="tabular-nums opacity-60">{compact(count)}</span>
          </button>
        );
      })}

      <div className="h-4 w-px bg-border mx-1" />

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-6 px-2 text-xs gap-1",
              processFilter.size > 0 && "bg-primary/10 text-primary"
            )}
          >
            <Filter className="size-3" />
            Process
            {processFilter.size > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums">
                {processFilter.size}
              </Badge>
            )}
            <ChevronDown className="size-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <div className="p-2 border-b">
            <Input
              value={processQuery}
              onChange={(event) => setProcessQuery(event.target.value)}
              placeholder="Find a process..."
              className="h-7 text-xs"
            />
          </div>
          <ScrollArea className="h-64">
            <div className="p-1">
              {shownProcesses.length === 0 && (
                <p className="text-xs text-muted-foreground p-3 text-center">No process matches.</p>
              )}
              {shownProcesses.map((entry) => {
                const isOn = processFilter.has(entry.name);
                return (
                  <button
                    key={entry.name}
                    type="button"
                    onClick={() => setProcessFilter(toggle(processFilter, entry.name))}
                    className="w-full flex items-center gap-2 px-2 py-1 rounded text-xs hover:bg-muted text-left"
                  >
                    <Check className={cn("size-3 shrink-0", !isOn && "opacity-0")} />
                    <span className="font-mono truncate flex-1" title={entry.name}>
                      {entry.name}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {compact(entry.count)}
                    </span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>

      {/* Whether a search narrows the list or just walks matches in place. */}
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-6 px-2 text-xs gap-1",
          searchMode === "filter" && "bg-primary/10 text-primary"
        )}
        onClick={() => setSearchMode(searchMode === "filter" ? "highlight" : "filter")}
        title="Narrow the list to search matches instead of stepping through them"
      >
        <ListFilter className="size-3" />
        Search filters
      </Button>

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs gap-1 text-muted-foreground"
          onClick={() => clearFilters()}
        >
          <X className="size-3" />
          Clear
        </Button>
      )}

      <div className="ml-auto text-xs text-muted-foreground tabular-nums pr-1">
        {visibleCount === totalCount ? (
          <>{totalCount.toLocaleString()} lines</>
        ) : (
          <>
            <span className="text-foreground font-medium">{visibleCount.toLocaleString()}</span> of{" "}
            {totalCount.toLocaleString()} lines
          </>
        )}
      </div>
    </div>
  );
};
