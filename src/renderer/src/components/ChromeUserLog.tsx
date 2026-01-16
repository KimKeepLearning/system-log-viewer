import {
  chromeUserLogAtom,
  chromePreviousUserLogAtom,
  chromeSystemLogAtom,
  chromePreviousSystemLogAtom,
  apsServerLogAtom,
  bluetoothLogAtom,
  clobberStateAtom,
  audioDiagnosticsLogAtom
} from "@renderer/lib/atom";
import { useAtomValue } from "jotai";
import { TabsContent } from "@renderer/components/ui/tabs";
import { LogType, IUserLog } from "@renderer/lib/typings";
import { cn } from "@renderer/lib/utils";
import { useMemo, useState } from "react";
import { List, useDynamicRowHeight } from "react-window";
import { AutoSizer } from "react-virtualized-auto-sizer";
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
  INFO: "text-blue-500"
};

interface LogGroup {
  main: IUserLog;
  count: number;
  children: IUserLog[];
}

interface LogRowProps {
  groupedLogs: LogGroup[];
  expandedIndices: Record<number, boolean>;
  toggleGroup: (index: number) => void;
}

const LogRow = ({
  log,
  isMain = true,
  style
}: {
  log: IUserLog;
  isMain?: boolean;
  style?: React.CSSProperties;
}) => (
  <div
    style={style}
    className={cn(
      "text-text-primary font-mono text-xs flex gap-2 py-0.5 border-b border-border/50 last:border-0 hover:bg-fill-component-navigation group",
      !isMain && "pl-8 bg-muted/20"
    )}
  >
    {!isMain && <>&gt;</>}
    {log.level && (
      <span className={cn("shrink-0 w-12 font-bold text-center", LogLevelMap[log.level])}>
        {log.level}
      </span>
    )}
    {log.process && (
      <span
        className="text-muted-foreground shrink-0 w-32 truncate text-right mr-2"
        title={log.process}
      >
        {log.process}
      </span>
    )}
    {log.timestamp && (
      <span className="text-muted-foreground shrink-0 min-w-[180px]">{log.timestamp}</span>
    )}
    <span className="whitespace-pre-wrap break-all flex-1 text-text-secondary">
      {log.source && <span className="text-muted-foreground mr-1">[{log.source}]</span>}
      <span className="text-text-primary font-medium">
        <b>{log.message}</b>
      </span>
    </span>
  </div>
);

const ChromeUserLogInner = ({ logType }: { logType: LogType }) => {
  const chromeUserLog = useAtomValue(chromeUserLogAtom);
  const chromePreviousUserLog = useAtomValue(chromePreviousUserLogAtom);
  const chromeSystemLog = useAtomValue(chromeSystemLogAtom);
  const chromePreviousSystemLog = useAtomValue(chromePreviousSystemLogAtom);
  const apsServerLog = useAtomValue(apsServerLogAtom);
  const bluetoothLog = useAtomValue(bluetoothLogAtom);
  const clobberStateLog = useAtomValue(clobberStateAtom);
  const audioDiagnosticsLog = useAtomValue(audioDiagnosticsLogAtom);

  const logs = useMemo(() => {
    switch (logType) {
      case LogType.ChromeUserLog:
        return chromeUserLog;
      case LogType.ChromePreviousUserLog:
        return chromePreviousUserLog;
      case LogType.ChromeSystemLog:
        return chromeSystemLog;
      case LogType.ChromePreviousSystemLog:
        return chromePreviousSystemLog;
      case LogType.ApsServer:
        return apsServerLog;
      case LogType.BluetoothLog:
        return bluetoothLog;
      case LogType.ClobberState:
        return clobberStateLog;
      case LogType.AudioDiagnostics:
        return audioDiagnosticsLog;
      default:
        return [];
    }
  }, [
    logType,
    chromeUserLog,
    chromePreviousUserLog,
    chromeSystemLog,
    chromePreviousSystemLog,
    apsServerLog,
    bluetoothLog,
    clobberStateLog,
    audioDiagnosticsLog
  ]);

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

  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: 30,
    key: logType
  });

  const [expandedIndices, setExpandedIndices] = useState<Record<number, boolean>>({});

  const toggleGroup = (index: number) => {
    const isExpanded = !expandedIndices[index];
    setExpandedIndices((prev) => ({
      ...prev,
      [index]: isExpanded
    }));

    const group = groupedLogs[index];
    let newHeight = 30;
    if (group.count > 1 && isExpanded) {
      newHeight = 30 + group.children.length * 30;
    }
    dynamicRowHeight.setRowHeight(index, newHeight);
  };

  const Row = ({
    index,
    style,
    groupedLogs: groupedLogsProp,
    expandedIndices: expandedIndicesProp,
    toggleGroup: toggleGroupProp
  }: {
    index: number;
    style: React.CSSProperties;
  } & LogRowProps) => {
    const group = groupedLogsProp[index];
    const isExpanded = expandedIndicesProp[index];

    return (
      <div style={style}>
        {group.count === 1 ? (
          <LogRow log={group.main} />
        ) : (
          <Collapsible open={isExpanded} onOpenChange={() => toggleGroupProp(index)}>
            <div className="flex items-center gap-1 border-b border-border/50 hover:bg-fill-component-navigation h-7.5">
              <div className="flex-1 min-w-0">
                <div className="text-text-primary font-mono text-xs flex gap-2 py-0.5 last:border-0 items-center">
                  <span className={cn("shrink-0 w-12 font-bold text-center")}>
                    {group.main.level}
                  </span>
                  <span
                    className="text-muted-foreground shrink-0 w-32 truncate text-right mr-2"
                    title={group.main.process}
                  >
                    {group.main.process}
                  </span>
                  <span className="text-muted-foreground shrink-0 min-w-45">
                    {group.main.timestamp}
                  </span>
                  <span className="whitespace-pre-wrap break-all flex-1 text-text-secondary flex items-center">
                    {group.main.source && (
                      <span className="text-muted-foreground mr-1">[{group.main.source}]</span>
                    )}
                    <span className="text-text-primary font-medium truncate">
                      <b>{group.main.message}</b>
                    </span>
                    <CollapsibleTrigger asChild>
                      <Badge
                        variant="secondary"
                        className="ml-1 cursor-pointer h-5 px-1.5 min-w-8 justify-center bg-fill-interaction-secondary"
                      >
                        x{group.count}
                      </Badge>
                    </CollapsibleTrigger>
                  </span>
                </div>
              </div>
            </div>
            <CollapsibleContent>
              {group.children.map((child, idx) => (
                <div key={idx} className="h-7.5 w-full border-b border-border/50">
                  <LogRow log={child} isMain={false} />
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    );
  };

  return (
    <TabsContent value={logType} className="h-[calc(100vh-140px)]">
      <AutoSizer
        renderProp={({ height, width }) => {
          if (!height || !width) {
            return null;
          }
          return (
            <List<LogRowProps>
              className="scrollbar-container"
              style={{ height, width, overflowX: "hidden" }}
              rowCount={groupedLogs.length}
              rowHeight={dynamicRowHeight}
              overscanCount={5}
              rowProps={{ groupedLogs, expandedIndices, toggleGroup }}
              rowComponent={Row}
            />
          );
        }}
      />
    </TabsContent>
  );
};

export const ChromeUserLog = (props: { logType: LogType }) => {
  return <ChromeUserLogInner {...props} />;
};
