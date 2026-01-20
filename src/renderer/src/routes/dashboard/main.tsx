import { createFileRoute } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  logStructureAtom,
  logKeysAtom,
  parsedLogsMapAtom,
  searchQueryAtom,
  isRegexAtom,
  searchMatchesCountAtom,
  currentMatchIndexAtom,
  baseDeviceInfoAtom
} from "@renderer/lib/atom";
import { useRef, useState, useEffect, useCallback } from "react";
import { VirtuosoHandle } from "react-virtuoso";
import { Checkbox } from "@renderer/components/ui/checkbox";

import { useLogProcessing } from "./hooks/use-log-processing";
import { useLogSearch } from "./hooks/use-log-search";
import { FileSidebar } from "./components/file-sidebar";
import { LogList } from "./components/log-list";

export const Route = createFileRoute("/dashboard/main")({
  component: RouteComponent
});

const Tag = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="text-[10px] font-medium bg-muted text-muted-foreground rounded-sm border border-border px-1.5 py-0.5">
      {children}
    </div>
  );
};

function RouteComponent() {
  const logStructure = useAtomValue(logStructureAtom);
  const logKeys = useAtomValue(logKeysAtom);
  const parsedLogs = useAtomValue(parsedLogsMapAtom);
  const deviceInfo = useAtomValue(baseDeviceInfoAtom);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [pendingScrollKey, setPendingScrollKey] = useState<string | null>(null);
  const [isMergedView, setIsMergedView] = useState(false);

  const [searchQuery] = useAtom(searchQueryAtom);
  const [isRegex] = useAtom(isRegexAtom);
  const setMatchesCount = useSetAtom(searchMatchesCountAtom);
  const [currentMatchIndex] = useAtom(currentMatchIndexAtom);

  // Default select first file
  useEffect(() => {
    const files = Object.keys(logStructure);
    if (files.length > 0 && !selectedFileName) {
      setSelectedFileName(files[0]);
    } else if (files.length > 0 && selectedFileName && !files.includes(selectedFileName)) {
      // If selected file disappeared (e.g. clear logs), select first
      setSelectedFileName(files[0]);
    }
  }, [logStructure, selectedFileName]);

  // Use Custom Hook for Log Processing
  const { allLogs, fileIndices } = useLogProcessing(
    selectedFileName,
    isMergedView,
    logStructure,
    parsedLogs
  );

  // Use Custom Hook for Search
  const matchIndices = useLogSearch(allLogs, searchQuery, isRegex);

  // Handle pending scroll after view update
  useEffect(() => {
    if (pendingScrollKey && fileIndices[pendingScrollKey] !== undefined) {
      virtuosoRef.current?.scrollToIndex({
        index: fileIndices[pendingScrollKey],
        align: "start"
      });
      setPendingScrollKey(null);
    }
  }, [pendingScrollKey, fileIndices]);

  const scrollToSection = useCallback(
    (key: string) => {
      const fileName = key.split("::")[0];
      if (fileName !== selectedFileName) {
        setSelectedFileName(fileName);
        setPendingScrollKey(key);
      } else {
        const index = fileIndices[key];
        if (index !== undefined && virtuosoRef.current) {
          virtuosoRef.current.scrollToIndex({ index, align: "start" });
        }
      }
    },
    [selectedFileName, fileIndices]
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Update match count
  useEffect(() => {
    setMatchesCount(matchIndices.length);
  }, [matchIndices.length, setMatchesCount]);

  // Scroll to active match
  useEffect(() => {
    if (matchIndices.length > 0) {
      // Ensure index is within bounds (though dashboard should handle wrapping, we safeguard)
      const targetMatchIndex = Math.abs(currentMatchIndex) % matchIndices.length;
      const targetLogIndex = matchIndices[targetMatchIndex];

      virtuosoRef.current?.scrollToIndex({
        index: targetLogIndex,
        align: "center",
        behavior: "auto"
      });
    }
  }, [currentMatchIndex, matchIndices]);

  if (logKeys.length === 0) {
    return <div className="p-4">No logs found. Please open a log file.</div>;
  }

  const allFiles = Object.keys(logStructure);

  return (
    <div className="w-full h-full overflow-hidden flex flex-row">
      <FileSidebar
        files={allFiles}
        logStructure={logStructure}
        selectedFileName={selectedFileName}
        activeFile={activeFile}
        onSelectFile={setSelectedFileName}
        onScrollToSection={scrollToSection}
      />

      {/* Main Content */}
      <div className="flex-1 overflow-hidden relative bg-background">
        <div className="flex items-center gap-1 p-2 border-b bg-background z-10">
          <Tag>Board: {deviceInfo.board || "Unknown"}</Tag>
          <Tag>OS Version: {deviceInfo.version || "Unknown"}</Tag>
          <Tag>ARC Status: {deviceInfo.arcStatus || "Unknown"}</Tag>

          <div className="h-4 w-px bg-border/50 mx-2" />
          <div className="flex items-center space-x-2">
            <Checkbox
              id="merged-view"
              checked={isMergedView}
              onCheckedChange={(c) => setIsMergedView(!!c)}
            />
            <label
              htmlFor="merged-view"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer text-muted-foreground select-none"
            >
              Merge with timestamp
            </label>
          </div>
        </div>

        <LogList
          logs={allLogs}
          fileIndices={fileIndices}
          activeFile={activeFile}
          onActiveFileChange={setActiveFile}
          isMergedView={isMergedView}
          expandedIds={expandedIds}
          onToggleExpand={toggleExpand}
          searchQuery={searchQuery}
          isRegex={isRegex}
          virtuosoRef={virtuosoRef}
        />
      </div>
    </div>
  );
}
