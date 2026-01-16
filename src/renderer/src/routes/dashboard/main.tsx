import { createFileRoute } from "@tanstack/react-router";
import { TabsList, Tabs, TabsTrigger } from "@renderer/components/ui/tabs";
import { ChromeUserLog } from "@renderer/components/ChromeUserLog";
import { useAtom, useAtomValue } from "jotai";
import {
  logKeysAtom,
  parsedLogsMapAtom,
  activeTabAtom
} from "@renderer/lib/atom";
import { useEffect } from "react";

export const Route = createFileRoute("/dashboard/main")({
  component: RouteComponent
});

function RouteComponent() {
  const logKeys = useAtomValue(logKeysAtom);
  const parsedLogs = useAtomValue(parsedLogsMapAtom);
  const [activeTab, setActiveTab] = useAtom(activeTabAtom);

  useEffect(() => {
    if (logKeys.length > 0 && !activeTab) {
      setActiveTab(logKeys[0]);
    }
  }, [logKeys, activeTab, setActiveTab]);

  if (logKeys.length === 0) {
    return <div className="p-4">No logs found. Please open a log file.</div>;
  }

  return (
    <div className="w-full h-[calc(100vh-100px)] scrollbar-container overflow-hidden p-4">
      <Tabs
        value={activeTab || logKeys[0]}
        onValueChange={setActiveTab}
        orientation="vertical"
      >
        <TabsList className="h-[calc(100vh-140px)] scrollbar-container flex-col w-40 justify-start">
          {logKeys.map((key) => {
            const logs = parsedLogs[key];
            if (!logs || logs.length === 0) return null;
            return (
              <TabsTrigger
                key={key}
                value={key}
                className="w-full h-auto whitespace-normal text-left justify-start break-words py-2 my-0.5 shrink-0"
                title={key}
              >
                {key}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {logKeys.map((key) => {
          const logs = parsedLogs[key];
          if (!logs || logs.length === 0) return null;
          return <ChromeUserLog key={key} logKey={key} />;
        })}
      </Tabs>
    </div>
  );
}
