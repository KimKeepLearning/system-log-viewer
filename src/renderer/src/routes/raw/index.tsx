import { logContentAtom } from "@renderer/lib/atom";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { Button } from "@vibeus/ui";
export const Route = createFileRoute("/raw/")({
  component: RouteComponent
});

function RouteComponent() {
  const logContent = useAtomValue(logContentAtom);
  const router = useRouter();
  return (
    <div className="flex flex-col">
      <div className="flex p-spacing-sm">
        <Button variant="secondary" onClick={() => router.history.back()}>
          Back
        </Button>
      </div>
      <div>
        {logContent.split("\n").map((line, index) => (
          <div key={index} style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
