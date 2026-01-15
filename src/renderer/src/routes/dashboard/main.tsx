import { createFileRoute } from "@tanstack/react-router";
import { TabsList, Tabs, TabsContent, TabsTrigger } from "@renderer/components/ui/tabs";
import { LogType } from "@renderer/lib/typings/device";
import { ChromeUserLog } from "@renderer/components/ChromeUserLog";

export const Route = createFileRoute("/dashboard/main")({
  component: RouteComponent
});

function RouteComponent() {
  return (
    <div className="w-full h-[calc(100vh-100px)] scrollbar-container overflow-hidden p-4">
      <Tabs defaultValue={LogType.ChromeUserLog} orientation="vertical">
        <TabsList className="h-[calc(100vh-140px)] scrollbar-container flex-col w-40 justify-start">
          <TabsTrigger value={LogType.ChromeUserLog}>Chrome User Log</TabsTrigger>
          
        </TabsList>
        <ChromeUserLog />
      </Tabs>
    </div>
  );
}
