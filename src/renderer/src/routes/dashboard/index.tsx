import { baseDeviceInfoAtom } from "@renderer/lib/atom";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import LogoIcon from "@renderer/assets/file.svg?react";
import { Button } from "@vibeus/ui";
import { useSelectFile } from "@renderer/hooks/use-select-file";
import { useEasterEgg } from "@renderer/hooks/use-easter-egg";

export const Route = createFileRoute("/dashboard/")({
  component: RouteComponent
});

function RouteComponent() {
  const deviceInfo = useAtomValue(baseDeviceInfoAtom);

  const { handleUploadClick } = useSelectFile();
  const { handleLogoClick } = useEasterEgg();
  return (
    <div className="w-screen h-screen bg-fill-background-surface-l1">
      {/* Header */}
      <div className="w-full flex items-center p-spacing-sm">
        {/* Logo */}
        <div className="flex items-center gap-spacing-xs" onClick={handleLogoClick}>
          <LogoIcon className="size-size-sm" />
          <div className="text-body-bold">System Log Viewer</div>
        </div>
        <div className="flex items-center ml-spacing-sm gap-1">
          <Tag>Board: {deviceInfo.board}</Tag>
          <Tag>OS Version: {deviceInfo.version}</Tag>
          <Tag>ARC Status: {deviceInfo.arcStatus}</Tag>
        </div>
        <div className="flex-1"></div>
        <div className="flex items-center">
          <Button
            variant="secondary"
            className="bg-fill-background-inverse text-text-on-interaction-inverse h-6"
            onClick={handleUploadClick}
          >
            Upload new
          </Button>
        </div>
      </div>
      <Outlet />
    </div>
  );
}

const Tag = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="text-tag text-text-secondary rounded-sm border border-stroke-divider p-1">
      {children}
    </div>
  );
};
