import { useAtomValue } from "jotai";
import { Image as ImageIcon } from "lucide-react";
import { Button } from "@vibeus/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@renderer/components/ui/dialog";
import { screenshotsAtom } from "@renderer/lib/atom";

export function ScreenshotViewer() {
  const screenshots = useAtomValue(screenshotsAtom);

  if (screenshots.length === 0) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="text" className="h-6 text-xs px-2 gap-1" title="View screenshots">
          <ImageIcon className="h-3.5 w-3.5" />
          {screenshots.length > 1 ? `Screenshots (${screenshots.length})` : "Screenshot"}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Screenshot</DialogTitle>
          <DialogDescription>Captured with the feedback report.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto max-h-[70vh] scrollbar-container">
          {screenshots.map((screenshot) => (
            <figure key={screenshot.id} className="flex flex-col gap-1">
              <img
                src={screenshot.imageDataUrl}
                alt={screenshot.name}
                className="w-full rounded border border-border object-contain"
              />
              <figcaption
                className="text-xs text-muted-foreground truncate"
                title={screenshot.name}
              >
                {screenshot.name}
              </figcaption>
            </figure>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
