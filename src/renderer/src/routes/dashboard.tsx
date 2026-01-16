import {
  baseDeviceInfoAtom,
  searchQueryAtom,
  isRegexAtom,
  searchMatchesCountAtom,
  currentMatchIndexAtom
} from "@renderer/lib/atom";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";
import LogoIcon from "@renderer/assets/file.svg?react";
import { Button } from "@vibeus/ui";
import { Input } from "@renderer/components/ui/input";
import { useSelectFile } from "@renderer/hooks/use-select-file";
import { useEasterEgg } from "@renderer/hooks/use-easter-egg";
import { Search, ArrowUp, ArrowDown, Regex } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent
});

function RouteComponent() {
  const deviceInfo = useAtomValue(baseDeviceInfoAtom);
  const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom);
  const [isRegex, setIsRegex] = useAtom(isRegexAtom);
  const matchesCount = useAtomValue(searchMatchesCountAtom);
  const [currentMatchIndex, setCurrentMatchIndex] = useAtom(currentMatchIndexAtom);
  const [isValidRegex, setIsValidRegex] = useState(true);

  useEffect(() => {
    if (isRegex && searchQuery) {
      try {
        new RegExp(searchQuery);
        setIsValidRegex(true);
      } catch {
        setIsValidRegex(false);
      }
    } else {
      setIsValidRegex(true);
    }
  }, [searchQuery, isRegex]);

  const { handleUploadClick } = useSelectFile();
  const { handleLogoClick } = useEasterEgg();

  const handlePrevMatch = () => {
    if (matchesCount === 0) return;
    setCurrentMatchIndex((prev) => (prev - 1 + matchesCount) % matchesCount);
  };

  const handleNextMatch = () => {
    if (matchesCount === 0) return;
    setCurrentMatchIndex((prev) => (prev + 1) % matchesCount);
  };

  return (
    <div className="w-screen h-screen bg-fill-background-surface-l1 scrollbar-container">
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

        <div className="flex-1 flex justify-end mr-4 items-center gap-2">
          <div className="relative flex items-center w-[400px]">
            <Search className="absolute left-2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isRegex ? "Regex pattern (e.g. ^Error.*)" : "Search logs..."}
              className={cn(
                "pl-8 pr-[160px] h-8 bg-fill-background-inverse/10 border-none focus-visible:ring-1 min-w-0 flex-1",
                !isValidRegex && "ring-1 ring-red-500 text-red-500 focus-visible:ring-red-500"
              )}
            />

            <div className="absolute right-2 top-0 bottom-0 flex items-center gap-2 z-20">
              <Button
                variant="text"
                className={cn(
                  "h-6 w-6 hover:bg-transparent p-0 min-w-0 justify-center",
                  isRegex ? "text-primary" : "text-muted-foreground"
                )}
                onClick={() => setIsRegex(!isRegex)}
                title="Toggle Regex"
              >
                <Regex className="h-4 w-4" />
              </Button>

              <div className="h-4 w-px bg-border/50" />

              {matchesCount > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums min-w-[3ch] text-center">
                  {currentMatchIndex + 1}/{matchesCount}
                </span>
              )}
              <div className="flex gap-0.5">
                <Button
                  variant="text"
                  className="h-6 w-6 p-0 min-w-0 justify-center z-10 hover:bg-fill-layout-surface-base"
                  onClick={handlePrevMatch}
                  disabled={matchesCount === 0}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="text"
                  className="h-6 w-6 p-0 min-w-0 justify-center z-10 hover:bg-fill-layout-surface-base"
                  onClick={handleNextMatch}
                  disabled={matchesCount === 0}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

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
