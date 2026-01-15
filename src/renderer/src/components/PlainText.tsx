import { TabsContent } from "@renderer/components/ui/tabs";
import { LogType } from "@renderer/lib/typings";

export const PlainText = ({ text, logType }: { text: string; logType: LogType }) => {
  return (
    <TabsContent value={logType} className="h-[calc(100vh-140px)] scrollbar-container">
      <pre className="text-[14px]">{text}</pre>
    </TabsContent>
  );
};
