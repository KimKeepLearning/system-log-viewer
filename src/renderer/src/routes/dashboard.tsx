import { createFileRoute, Outlet } from "@tanstack/react-router";
import LogoIcon from "@renderer/assets/file.svg?react";
import { Button } from "@vibeus/ui";
import { Toaster } from "@renderer/components/ui/sonner";
import { ScreenshotViewer } from "@renderer/components/screenshot-viewer";
import { LogFieldsDialog } from "@renderer/components/log-fields-dialog";
import { BookmarksDialog } from "@renderer/components/bookmarks-dialog";
import { useSelectFile } from "@renderer/hooks/use-select-file";
import { useEasterEgg } from "@renderer/hooks/use-easter-egg";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent
});

function RouteComponent() {
  const { handleUploadClick, isProcessing, progressStatus } = useSelectFile();
  const { handleLogoClick } = useEasterEgg();

  return (
    <div className="w-screen h-screen bg-fill-background-surface-l1 scrollbar-container flex flex-col overflow-hidden">
      {/* Header. Search used to live here, wedged into the title bar; it now sits
          directly above the list it searches. */}
      <div className="w-full flex items-center gap-2 px-2 py-1.5 border-b shrink-0">
        <div
          className="flex items-center gap-spacing-xs cursor-pointer shrink-0"
          onClick={handleLogoClick}
        >
          <LogoIcon className="size-size-sm" />
          <div className="text-body-bold">System Log Viewer</div>
        </div>

        <div className="flex-1" />

        <BookmarksDialog />
        <LogFieldsDialog />
        <ScreenshotViewer />

        <Button
          variant="secondary"
          className="bg-fill-background-inverse text-text-on-interaction-inverse h-6 text-xs px-3"
          onClick={handleUploadClick}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <>
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              <span className="truncate max-w-25 inline-block align-bottom">
                {progressStatus || "Loading..."}
              </span>
            </>
          ) : (
            "Upload new"
          )}
        </Button>
      </div>

      <Outlet />

      {/* Providers (and with it the Toaster) is mounted inside /home only, so
          the dashboard needs its own to give copy actions any feedback. */}
      <Toaster position="bottom-right" />
    </div>
  );
}
