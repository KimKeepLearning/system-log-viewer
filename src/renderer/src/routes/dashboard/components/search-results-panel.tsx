import { useAtomValue } from "jotai";
import { Virtuoso } from "react-virtuoso";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { getLevelColor } from "@renderer/lib/log-utils";
import { sectionNameOf } from "@renderer/lib/log-domains";
import { searchQueryAtom } from "@renderer/lib/atom";
import { ExtendedLog } from "../types";

interface SearchResultsPanelProps {
  logs: ExtendedLog[];
  matchIndices: number[];
  activeMatchIndex: number;
  isOpen: boolean;
  onToggle: () => void;
  onJumpTo: (logIndex: number) => void;
}

const clock = (log: ExtendedLog): string =>
  typeof log.ts === "number" ? new Date(log.ts / 1000).toISOString().slice(11, 23) : "";

/**
 * Stepping through matches one at a time tells you nothing about which of them
 * is worth reading. Listing them together makes three hundred hits scannable.
 */
export const SearchResultsPanel = ({
  logs,
  matchIndices,
  activeMatchIndex,
  isOpen,
  onToggle,
  onJumpTo
}: SearchResultsPanelProps) => {
  const query = useAtomValue(searchQueryAtom);

  if (!query) return null;

  return (
    <div className="border-t bg-muted/20 shrink-0 flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {isOpen ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
        <span className="font-medium">
          {matchIndices.length.toLocaleString()} {matchIndices.length === 1 ? "match" : "matches"}
        </span>
        <span className="opacity-60 truncate">for “{query}”</span>
      </button>

      {isOpen && matchIndices.length > 0 && (
        <div className="h-48 border-t">
          <Virtuoso
            data={matchIndices}
            className="scrollbar-container"
            itemContent={(_position, logIndex) => {
              const log = logs[logIndex];
              if (!log) return null;
              const isActive = logIndex === activeMatchIndex;

              return (
                <button
                  type="button"
                  onClick={() => onJumpTo(logIndex)}
                  className={cn(
                    "w-full text-left flex items-baseline gap-2 px-2 py-0.5 font-mono text-[11px] border-b border-border/30",
                    isActive ? "bg-primary/15" : "hover:bg-muted/60"
                  )}
                >
                  <span className="text-muted-foreground/70 tabular-nums shrink-0 w-24 truncate">
                    {clock(log)}
                  </span>
                  {log.level && (
                    <span className={cn("shrink-0 w-10 font-bold", getLevelColor(log.level))}>
                      {log.level}
                    </span>
                  )}
                  <span
                    className="text-muted-foreground shrink-0 w-32 truncate"
                    title={log.sourceFile}
                  >
                    {sectionNameOf(log.sourceFile)}
                  </span>
                  <span className="truncate flex-1 min-w-0">{log.message}</span>
                </button>
              );
            }}
          />
        </div>
      )}
    </div>
  );
};
