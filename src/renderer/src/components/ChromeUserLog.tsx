import { chromeUserLogAtom } from "@renderer/lib/atom";
import { useAtomValue } from "jotai";
import { TabsContent } from "@renderer/components/ui/tabs";
import { LogType } from "@renderer/lib/typings/device";

export const ChromeUserLog = () => {
  const chromeUserLog = useAtomValue(chromeUserLogAtom);

  return (
    <TabsContent value={LogType.ChromeUserLog}>
      {(chromeUserLog ?? []).map((line, index) => (
        <div key={index} className="text-text-primary">
          {line}
        </div>
      ))}
    </TabsContent>
  );
};
