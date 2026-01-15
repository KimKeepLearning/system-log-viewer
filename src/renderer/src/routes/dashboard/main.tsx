import { createFileRoute } from "@tanstack/react-router";
import { TabsList, Tabs, TabsTrigger } from "@renderer/components/ui/tabs";
import { LogType } from "@renderer/lib/typings/device";
import { ChromeUserLog } from "@renderer/components/ChromeUserLog";
import { useAtomValue } from "jotai";
import {
  chromeUserLogAtom,
  chromePreviousUserLogAtom,
  chromePreviousSystemLogAtom,
  chromeSystemLogAtom
} from "@renderer/lib/atom";

export const Route = createFileRoute("/dashboard/main")({
  component: RouteComponent
});

function RouteComponent() {
  const chromeUserLog = useAtomValue(chromeUserLogAtom);
  const chromePreviousUserLog = useAtomValue(chromePreviousUserLogAtom);
  const chromeSystemLog = useAtomValue(chromeSystemLogAtom);
  const chromePreviousSystemLog = useAtomValue(chromePreviousSystemLogAtom);
  return (
    <div className="w-full h-[calc(100vh-100px)] scrollbar-container overflow-hidden p-4">
      <Tabs defaultValue={LogType.ChromeUserLog} orientation="vertical">
        <TabsList className="h-[calc(100vh-140px)] scrollbar-container flex-col w-40 justify-start">
          {chromeUserLog.length > 0 && (
            <TabsTrigger value={LogType.ChromeUserLog}>Chrome User Log</TabsTrigger>
          )}
          {chromePreviousUserLog.length > 0 && (
            <TabsTrigger value={LogType.ChromePreviousUserLog}>
              Chrome User Log(Previous)
            </TabsTrigger>
          )}
          {chromeSystemLog.length > 0 && (
            <TabsTrigger value={LogType.ChromeSystemLog}>Chrome System Log</TabsTrigger>
          )}
          {chromePreviousSystemLog.length > 0 && (
            <TabsTrigger value={LogType.ChromePreviousSystemLog}>
              Chrome System Log(Previous)
            </TabsTrigger>
          )}
        </TabsList>
        <ChromeUserLog logType={LogType.ChromeUserLog} />
        <ChromeUserLog logType={LogType.ChromePreviousUserLog} />
        <ChromeUserLog logType={LogType.ChromeSystemLog} />
        <ChromeUserLog logType={LogType.ChromePreviousSystemLog} />
      </Tabs>
    </div>
  );
}
