import { parsedLogsMapAtom } from "@renderer/lib/atom";
import { useAtomValue } from "jotai";
import { TabsContent } from "@renderer/components/ui/tabs";
import { IUserLog } from "@renderer/lib/typings";
import { cn } from "@renderer/lib/utils";
import { useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
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
}

const LogRow = ({ log, isMain = true }: LogRowProps) => (
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
      <span className="text-muted-foreground shrink-0 min-w-45 pt-0.5">{log.timestamp}</span>
    )}
    <span className="flex-1 text-text-secondary min-w-0">
      <div className="whitespace-pre-wrap break-all">
        {log.source && (
          <span className="text-muted-foreground mr-1 select-text">[{log.source}]</span>
        )}
        <span className="text-text-primary font-medium select-text">
          <b>{log.message}</b>
        </span>
      </div>
    </span>
  </div>
);

const GroupedLogItem = ({
  group,
  isExpanded,
  toggleGroup
}: {
  group: LogGroup;
  isExpanded: boolean;
  toggleGroup: () => void;
}) => {
  if (group.count === 1) {
    return <LogRow log={group.main} />;
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
          {group.main.timestamp}
        </span>
        <span className="flex-1 text-text-secondary min-w-0 flex items-start">
          <div className="flex-1 whitespace-pre-wrap break-all">
            {group.main.source && (
              <span className="text-muted-foreground mr-1 select-text">
                [{group.main.source}]
              </span>
            )}
            <span className="text-text-primary font-medium select-text">
              <b>{group.main.message}</b>
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
          <LogRow key={idx} log={child} isMain={false} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
};

const ChromeUserLogInner = ({ logKey }: { logKey: string }) => {
  const parsedLogsMap = useAtomValue(parsedLogsMapAtom);

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
        style={{ height: "100%", width: "100%" }}
        totalCount={groupedLogs.length}
        itemContent={(index) => (
          <GroupedLogItem
            group={groupedLogs[index]}
            isExpanded={!!expandedIndices[index]}
            toggleGroup={() => toggleGroup(index)}
          />
        )}
      />
    </TabsContent>
  );
};

export const ChromeUserLog = (props: { logKey: string }) => {
  return <ChromeUserLogInner {...props} />;
};
