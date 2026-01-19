import { createFileRoute } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  logKeysAtom,
  parsedLogsMapAtom,
  searchQueryAtom,
  isRegexAtom,
  searchMatchesCountAtom,
  currentMatchIndexAtom
} from "@renderer/lib/atom";
import { useMemo, useRef, useState, useEffect } from "react";
import { LogRow } from "@renderer/components/log-viewer-shared";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { ScrollArea } from "@renderer/components/ui/scroll-area";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/button";
import { IUserLog } from "@renderer/lib/typings";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent
} from "@renderer/components/ui/collapsible";
import { Badge } from "@renderer/components/ui/badge";

export const Route = createFileRoute("/dashboard/main")({
  component: RouteComponent
});

interface ExtendedLog extends IUserLog {
  sourceFile: string;
  count: number;
  id: string;
  duplicates: IUserLog[];
}

function RouteComponent() {
  const logKeys = useAtomValue(logKeysAtom);
  const parsedLogs = useAtomValue(parsedLogsMapAtom);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [searchQuery] = useAtom(searchQueryAtom);
  const [isRegex] = useAtom(isRegexAtom);
  const setMatchesCount = useSetAtom(searchMatchesCountAtom);
  const [currentMatchIndex] = useAtom(currentMatchIndexAtom);

  // Flatten logs efficiently and keep track of start indices
  const { allLogs, fileIndices } = useMemo(() => {
    const flatLogs: ExtendedLog[] = [];
    const indices: Record<string, number> = {};

    logKeys.forEach((key) => {
      indices[key] = flatLogs.length;
      const logs = parsedLogs[key] || [];

      for (let i = 0; i < logs.length; i++) {
        const currentHook = logs[i];
        const lastLog = flatLogs.length > indices[key] ? flatLogs[flatLogs.length - 1] : null;

        // Simple folding logic: same message, level, process
        if (
          lastLog &&
          lastLog.message === currentHook.message &&
          lastLog.level === currentHook.level &&
          lastLog.process === currentHook.process &&
          lastLog.sourceFile === key
        ) {
          lastLog.count++;
          lastLog.duplicates.push(currentHook);
        } else {
          flatLogs.push({
            ...currentHook,
            sourceFile: key,
            count: 1,
            duplicates: [],
            id: `${key}-${i}`
          });
        }
      }
    });

    return { allLogs: flatLogs, fileIndices: indices };
  }, [logKeys, parsedLogs]);

  // Search Match Logic
  const matchIndices = useMemo(() => {
    if (!searchQuery) return [];

    const indices: number[] = [];
    const queryLower = searchQuery.toLowerCase();

    let regex: RegExp | null = null;
    if (isRegex) {
      try {
        regex = new RegExp(searchQuery, "i");
      } catch {
        // invalid regex
      }
    }

    allLogs.forEach((log, index) => {
      // Build a search string similar to what the user sees
      const content = [log.timestamp, log.level, log.process, log.source, log.message]
        .filter(Boolean)
        .join(" ");

      if (regex) {
        if (regex.test(content)) indices.push(index);
      } else {
        if (content.toLowerCase().includes(queryLower)) indices.push(index);
      }
    });
    return indices;
  }, [allLogs, searchQuery, isRegex]);

  // Update match count
  useEffect(() => {
    setMatchesCount(matchIndices.length);
  }, [matchIndices.length, setMatchesCount]);

  // Scroll to active match
  useEffect(() => {
    if (matchIndices.length > 0) {
      // Ensure index is within bounds (though dashboard should handle wrapping, we safeguard)
      const targetMatchIndex = Math.abs(currentMatchIndex) % matchIndices.length;
      const targetLogIndex = matchIndices[targetMatchIndex];

      virtuosoRef.current?.scrollToIndex({
        index: targetLogIndex,
        align: "center",
        behavior: "auto"
      });
    }
  }, [currentMatchIndex, matchIndices]);

  if (logKeys.length === 0) {
    return <div className="p-4">No logs found. Please open a log file.</div>;
  }

  const handleAnchorClick = (key: string) => {
    const index = fileIndices[key];
    if (index !== undefined) {
      virtuosoRef.current?.scrollToIndex({ index, align: "start" });
      setActiveFile(key);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="w-full h-full overflow-hidden flex flex-row">
      {/* Sidebar Anchors */}
      <div className="w-64 border-r bg-muted/20 shrink-0 flex flex-col">
        <div className="p-3 font-semibold text-sm border-b">Log Files</div>
        <ScrollArea className="h-[calc(100vh-140px)] scrollbar-container ">
          <div className="p-2 flex flex-col gap-1">
            {logKeys.map((key) => (
              <Button
                key={key}
                variant={activeFile === key ? "secondary" : "ghost"}
                size="sm"
                className={cn(
                  "justify-start h-auto py-2 px-3 text-left font-normal whitespace-normal break-all hover:bg-fill-component-navigation",
                  activeFile === key && "bg-fill-component-navigation shadow-none"
                )}
                onClick={() => handleAnchorClick(key)}
              >
                {key}
              </Button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden relative bg-background">
        <Virtuoso
          ref={virtuosoRef}
          data={allLogs}
          rangeChanged={({ startIndex }) => {
            const log = allLogs[startIndex];
            if (log && log.sourceFile !== activeFile) {
              setActiveFile(log.sourceFile);
            }
          }}
          className="h-[calc(100vh-140px)] scrollbar-container "
          itemContent={(index, log) => (
            <>
              {fileIndices[log.sourceFile] === index && (
                <div className="bg-muted/50 px-4 py-1.5 font-bold text-xs border-b border-border/50 flex items-center gap-2 sticky top-0 z-10 backdrop-blur-sm">
                  <div className="w-1 h-3 bg-primary rounded-full"></div>
                  {log.sourceFile}
                </div>
              )}
              {log.count > 1 ? (
                <Collapsible
                  open={expandedIds.has(log.id)}
                  onOpenChange={() => toggleExpand(log.id)}
                >
                  <div className="pl-2 flex border-b border-border/40 last:border-0 hover:bg-muted/10 transition-colors flex-col">
                    <LogRow log={log} query={searchQuery} isRegex={isRegex}>
                      <CollapsibleTrigger asChild>
                        <Badge
                          variant="secondary"
                          className="ml-2 cursor-pointer h-5 px-1.5 min-w-8 justify-center bg-fill-interaction-secondary hover:bg-fill-interaction-secondary-hover inline-flex align-middle"
                        >
                          x{log.count}
                        </Badge>
                      </CollapsibleTrigger>
                    </LogRow>
                    <CollapsibleContent>
                      {log.duplicates.length > 0 && (
                        <div className="bg-muted/5 border-t border-border/30">
                          {log.duplicates.map((dup, i) => (
                            <div key={i} className="relative">
                              {/* Connecting line visual */}
                              <div className="border-b border-border/20 last:border-0">
                                <LogRow
                                  log={dup}
                                  query={searchQuery}
                                  isRegex={isRegex}
                                  isMain={false}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ) : (
                <div className="pl-2 flex border-b border-border/40 last:border-0 hover:bg-muted/10 transition-colors flex-col">
                  <div className="flex-1 min-w-0 flex items-start pr-2">
                    <div className="flex-1 min-w-0">
                      <LogRow log={log} query={searchQuery} isRegex={isRegex} />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        />
      </div>
    </div>
  );
}
