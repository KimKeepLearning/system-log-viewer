import {
  chromeUserLogAtom,
  chromePreviousUserLogAtom,
  chromeSystemLogAtom,
  chromePreviousSystemLogAtom,
  apsServerLogAtom,
  bluetoothLogAtom,
  clobberStateAtom
} from "@renderer/lib/atom";
import { useAtomValue } from "jotai";
import { TabsContent } from "@renderer/components/ui/tabs";
import { LogType, IUserLog } from "@renderer/lib/typings";
import { cn } from "@renderer/lib/utils";
import { useMemo, useState } from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent
} from "@renderer/components/ui/collapsible";
import { Badge } from "@renderer/components/ui/badge";

const LogLevelMap = {
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

const LogRow = ({ log, isMain = true }: { log: IUserLog; isMain?: boolean }) => (
  <div
    className={cn(
      "text-text-primary font-mono text-xs flex gap-2 py-0.5 border-b border-border/50 last:border-0 hover:bg-fill-component-navigation group",
      !isMain && "pl-8 bg-muted/20"
    )}
  >
    {!isMain && <>&gt;</>}
    <span className={cn("shrink-0 w-12 font-bold text-center", LogLevelMap[log.level])}>
      {log.level}
    </span>
    <span
      className="text-muted-foreground shrink-0 w-32 truncate text-right mr-2"
      title={log.process}
    >
      {log.process}
    </span>
    <span className="text-muted-foreground shrink-0 min-w-[180px]">{log.timestamp}</span>
    <span className="whitespace-pre-wrap break-all flex-1 text-text-secondary">
      {log.source && <span className="text-muted-foreground mr-1">[{log.source}]</span>}
      <span className="text-text-primary font-medium">
        <b>{log.message}</b>
      </span>
    </span>
  </div>
);

const GroupedRow = ({ group }: { group: LogGroup }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { main, count, children } = group;

  if (count === 1) {
    return <LogRow log={main} />;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center gap-1 border-b border-border/50 hover:bg-fill-component-navigation">
        <div className="flex-1 min-w-0">
          <div className="text-text-primary font-mono text-xs flex gap-2 py-0.5 last:border-0">
            <span className={cn("shrink-0 w-12 font-bold text-center", LogLevelMap[main.level])}>
              {main.level}
            </span>
            <span
              className="text-muted-foreground shrink-0 w-32 truncate text-right mr-2"
              title={main.process}
            >
              {main.process}
            </span>
            <span className="text-muted-foreground shrink-0 min-w-[180px]">{main.timestamp}</span>
            <span className="whitespace-pre-wrap break-all flex-1 text-text-secondary">
              {main.source && <span className="text-muted-foreground">[{main.source}]</span>}
              <span className="text-text-primary font-medium">
                <b>{main.message}</b>
              </span>
              <CollapsibleTrigger asChild>
                <Badge
                  variant="secondary"
                  className="ml-1 cursor-pointer h-5 px-1.5 min-w-[2rem] justify-center bg-fill-interaction-secondary"
                >
                  x{count}
                </Badge>
              </CollapsibleTrigger>
            </span>
          </div>
        </div>
      </div>

      <CollapsibleContent>
        {children.map((child, idx) => (
          <LogRow key={idx} log={child} isMain={false} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
};

export const ChromeUserLog = ({ logType }: { logType: LogType }) => {
  const chromeUserLog = useAtomValue(chromeUserLogAtom);
  const chromePreviousUserLog = useAtomValue(chromePreviousUserLogAtom);
  const chromeSystemLog = useAtomValue(chromeSystemLogAtom);
  const chromePreviousSystemLog = useAtomValue(chromePreviousSystemLogAtom);
  const apsServerLog = useAtomValue(apsServerLogAtom);
  const bluetoothLog = useAtomValue(bluetoothLogAtom);
  const clobberStateLog = useAtomValue(clobberStateAtom);
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
    clobberStateLog
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

  return (
    <TabsContent value={logType} className="h-[calc(100vh-140px)] scrollbar-container">
      {groupedLogs.map((group, index) => (
        <GroupedRow key={index} group={group} />
      ))}
    </TabsContent>
  );
};
