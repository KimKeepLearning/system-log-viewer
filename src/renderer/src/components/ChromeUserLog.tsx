import {
  parsedLogsMapAtom,
  searchQueryAtom,
  isRegexAtom,
  searchMatchesCountAtom,
  currentMatchIndexAtom,
  activeTabAtom,
  logKeysAtom
} from "@renderer/lib/atom";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { TabsContent } from "@renderer/components/ui/tabs";
import { IUserLog } from "@renderer/lib/typings";
import { cn } from "@renderer/lib/utils";
import { useMemo, useState, useEffect, useRef, ReactNode } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent
} from "@renderer/components/ui/collapsible";
import { Badge } from "@renderer/components/ui/badge";

const LogLevelMap: Record<string, string> = {
  ERROR: "text-red-500",
  WARN: "text-yellow-500",
  DEBUG: "text-gray-500",
  INFO: "text-blue-500",
  VERBOSE: "text-gray-400"
};

const getLevelColor = (level?: string) => {
  if (!level) return "text-gray-500";
  const normalized = level.toUpperCase().trim();
  return LogLevelMap[normalized] || "text-gray-500";
};

interface LogGroup {
  main: IUserLog;
  count: number;
  children: IUserLog[];
}

interface LogRowProps {
  log: IUserLog;
  isMain?: boolean;
  query?: string;
  isRegex?: boolean;
}

const LogRow = ({ log, isMain = true, query = "", isRegex = false }: LogRowProps) => (
  <div
    className={cn(
      "text-text-primary font-mono text-xs flex gap-2 py-1 border-b border-border/50 last:border-0 hover:bg-fill-component-navigation group items-start min-h-7.5",
      !isMain && "pl-8 bg-muted/20"
    )}
  >
    {!isMain && <div className="pt-0.5">&gt;</div>}
    {log.level && (
      <span className={cn("shrink-0 w-12 font-bold text-center pt-0.5", getLevelColor(log.level))}>
        {log.level}
      </span>
    )}
    {log.process && (
      <span
        className="text-muted-foreground shrink-0 w-32 truncate text-right mr-2 pt-0.5"
        title={log.process}
      >
        {log.process}
      </span>
    )}
    {log.timestamp && (
      <span className="text-muted-foreground shrink-0 min-w-45 pt-0.5">
        <HighlightedText text={log.timestamp} query={query} isRegex={isRegex} />
      </span>
    )}
    <span className="flex-1 text-text-secondary min-w-0">
      <div className="whitespace-pre-wrap break-all">
        {log.source && (
          <span className="text-muted-foreground mr-1 select-text">
            [<HighlightedText text={log.source} query={query} isRegex={isRegex} />]
          </span>
        )}
        <span className="text-text-primary font-medium select-text">
          <b>
            <HighlightedText text={log.message} query={query} isRegex={isRegex} />
          </b>
        </span>
      </div>
    </span>
  </div>
);

const GroupedLogItem = ({
  group,
  isExpanded,
  toggleGroup,
  query,
  isRegex
}: {
  group: LogGroup;
  isExpanded: boolean;
  toggleGroup: () => void;
  query: string;
  isRegex: boolean;
}) => {
  if (group.count === 1) {
    return <LogRow log={group.main} query={query} isRegex={isRegex} />;
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={toggleGroup}>
      <div className="text-text-primary font-mono text-xs flex gap-2 py-1 border-b border-border/50 last:border-0 hover:bg-fill-component-navigation group items-start min-h-7.5">
        <span
          className={cn(
            "shrink-0 w-12 font-bold text-center pt-0.5",
            getLevelColor(group.main.level)
          )}
        >
          {group.main.level}
        </span>
        <span
          className="text-muted-foreground shrink-0 w-32 truncate text-right mr-2 pt-0.5"
          title={group.main.process}
        >
          {group.main.process}
        </span>
        <span className="text-muted-foreground shrink-0 min-w-45 pt-0.5">
          <HighlightedText text={group.main.timestamp || ""} query={query} isRegex={isRegex} />
        </span>
        <span className="flex-1 text-text-secondary min-w-0 flex items-start">
          <div className="flex-1 whitespace-pre-wrap break-all">
            {group.main.source && (
              <span className="text-muted-foreground mr-1 select-text">
                [<HighlightedText text={group.main.source} query={query} isRegex={isRegex} />]
              </span>
            )}
            <span className="text-text-primary font-medium select-text">
              <HighlightedText text={group.main.message} query={query} isRegex={isRegex} />
            </span>
            <CollapsibleTrigger asChild>
              <Badge
                variant="secondary"
                className="ml-2 cursor-pointer h-5 px-1.5 min-w-8 justify-center bg-fill-interaction-secondary hover:bg-fill-interaction-secondary-hover inline-flex align-middle"
              >
                x{group.count}
              </Badge>
            </CollapsibleTrigger>
          </div>
        </span>
      </div>
      <CollapsibleContent>
        {group.children.map((child, idx) => (
          <LogRow key={idx} log={child} isMain={false} query={query} isRegex={isRegex} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
};

// Helper to highlight text
const HighlightedText = ({
  text,
  query,
  isRegex
}: {
  text: string;
  query: string;
  isRegex: boolean;
}) => {
  if (!query || !text) return <span>{text}</span>;

  try {
    const effectiveQuery = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(effectiveQuery, "gi");

    const elements: ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIndex) {
        elements.push(
          <span key={`text-${lastIndex}`}>{text.substring(lastIndex, match.index)}</span>
        );
      }
      elements.push(
        <span key={`match-${match.index}`} className="bg-yellow-500/50 text-black">
          {match[0]}
        </span>
      );
      lastIndex = re.lastIndex;
      if (re.lastIndex === match.index) {
        re.lastIndex++; // Avoid infinite loop for zero-width assertions
      }
    }

    if (lastIndex < text.length) {
      elements.push(<span key={`text-${lastIndex}`}>{text.substring(lastIndex)}</span>);
    }

    if (elements.length === 0) return <span>{text}</span>;

    return <span>{elements}</span>;
  } catch {
    return <span>{text}</span>;
  }
};

const ChromeUserLogInner = ({ logKey }: { logKey: string }) => {
  const parsedLogsMap = useAtomValue(parsedLogsMapAtom);
  const query = useAtomValue(searchQueryAtom);
  const isRegex = useAtomValue(isRegexAtom);
  const setMatchesCount = useSetAtom(searchMatchesCountAtom);
  const [currentMatchIndex, setCurrentMatchIndex] = useAtom(currentMatchIndexAtom);
  const activeTabValue = useAtomValue(activeTabAtom);
  const logKeys = useAtomValue(logKeysAtom);
  const activeTab = activeTabValue || logKeys[0];

  const logs = useMemo(() => {
    return parsedLogsMap[logKey] || [];
  }, [parsedLogsMap, logKey]);

  const groupedLogs = useMemo(() => {
    if (!logs) return [];

    const groups: LogGroup[] = [];
    let currentGroup: LogGroup | null = null;

    for (const log of logs) {
      if (
        currentGroup &&
        log.message === currentGroup.main.message &&
        log.process === currentGroup.main.process &&
        log.source === currentGroup.main.source &&
        log.level === currentGroup.main.level
      ) {
        currentGroup.count++;
        currentGroup.children.push(log);
      } else {
        currentGroup = {
          main: log,
          count: 1,
          children: []
        };
        groups.push(currentGroup);
      }
    }
    return groups;
  }, [logs]);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [matchIndices, setMatchIndices] = useState<number[]>([]);

  useEffect(() => {
    // Only update if this log is the active tab
    if (activeTab && activeTab !== logKey) return;

    if (!query) {
      setMatchesCount(0);
      setMatchIndices([]);
      setCurrentMatchIndex(0);
      return;
    }

    const indices: number[] = [];
    try {
      const effectiveQuery = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(effectiveQuery, "i");

      groupedLogs.forEach((group, idx) => {
        const matchesMessage = re.test(group.main.message);
        const matchesTimestamp = group.main.timestamp && re.test(group.main.timestamp);
        const matchesSource = group.main.source && re.test(group.main.source);

        if (matchesMessage || matchesTimestamp || matchesSource) {
          indices.push(idx);
        }
      });
    } catch {
      // Ignore invalid regex
    }

    setMatchIndices(indices);
    setMatchesCount(indices.length);
    // Reset index when search changes.
    // Note: If we switch tabs, we might want to preserve the index or reset it.
    // Here we reset it for simplicity when query changes or tab switches.
    // To preserve, needs more complex logic or per-tab atom state.
    setCurrentMatchIndex(0);
  }, [groupedLogs, query, isRegex, setMatchesCount, setCurrentMatchIndex, activeTab, logKey]);

  useEffect(() => {
    if (activeTab && activeTab !== logKey) return;

    if (
      matchIndices.length > 0 &&
      currentMatchIndex >= 0 &&
      currentMatchIndex < matchIndices.length
    ) {
      const targetRowIndex = matchIndices[currentMatchIndex];
      virtuosoRef.current?.scrollToIndex({
        index: targetRowIndex,
        align: "center",
        behavior: "auto"
      });
    }
  }, [currentMatchIndex, matchIndices, activeTab, logKey]);

  const [expandedIndices, setExpandedIndices] = useState<Record<number, boolean>>({});

  const toggleGroup = (index: number) => {
    setExpandedIndices((prev) => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  return (
    <TabsContent value={logKey} className="h-[calc(100vh-140px)] flex flex-col">
      <Virtuoso
        ref={virtuosoRef}
        style={{ height: "100%", width: "100%" }}
        totalCount={groupedLogs.length}
        itemContent={(index) => {
          const isActive = matchIndices.length > 0 && matchIndices[currentMatchIndex] === index;
          return (
            <div className={cn(isActive && "bg-status-warning-background")}>
              <GroupedLogItem
                group={groupedLogs[index]}
                isExpanded={!!expandedIndices[index]}
                toggleGroup={() => toggleGroup(index)}
                query={query}
                isRegex={isRegex}
              />
            </div>
          );
        }}
      />
    </TabsContent>
  );
};

export const ChromeUserLog = (props: { logKey: string }) => {
  return <ChromeUserLogInner {...props} />;
};
