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
  logFilesAtom
} from "@renderer/lib/atom";
import { parseDeviceInfo } from "@renderer/lib/log-parser";
import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { VirtuosoHandle } from "react-virtuoso";
import { Clock } from "lucide-react";
import { cn } from "@renderer/lib/utils";

import { useLogProcessing } from "./hooks/use-log-processing";
import { useLogSearch } from "./hooks/use-log-search";
import { useLogFilter } from "./hooks/use-log-filter";
import { FileSidebar } from "./components/file-sidebar";
import { FilterBar } from "./components/filter-bar";
import { TimelineStrip } from "./components/timeline-strip";
import { SearchResultsPanel } from "./components/search-results-panel";
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
  const logFiles = useAtomValue(logFilesAtom);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [pendingScrollKey, setPendingScrollKey] = useState<string | null>(null);
  const [isMergedView, setIsMergedView] = useState(false);
  const [isResultsOpen, setIsResultsOpen] = useState(false);

  const [searchQuery] = useAtom(searchQueryAtom);
  const [isRegex] = useAtom(isRegexAtom);
  const setMatchesCount = useSetAtom(searchMatchesCountAtom);
  const [currentMatchIndex] = useAtom(currentMatchIndexAtom);
  const deviceInfo = useMemo(() => {
    // If no file selected, or files list is empty
    if (!selectedFileName) {
      console.log("No selected file name", selectedFileName);
      return { board: undefined, version: undefined, arcStatus: undefined };
    }
    const file = logFiles.find((f) => f.name === selectedFileName);
    if (!file) {
      console.log("Selected file not found in logFiles", selectedFileName, logFiles);
      return { board: undefined, version: undefined, arcStatus: undefined };
    }
    return parseDeviceInfo(file.content);
  }, [selectedFileName, logFiles]);
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
  const { allLogs } = useLogProcessing(selectedFileName, isMergedView, logStructure, parsedLogs);

  const { logs: visibleLogs, processes, levelCounts } = useLogFilter(allLogs);

  // Section offsets have to follow the filtered list, otherwise the sidebar
  // jumps to whatever now sits at the unfiltered index.
  const fileIndices = useMemo(() => {
    const indices: Record<string, number> = {};
    if (isMergedView) return indices;
    for (let index = 0; index < visibleLogs.length; index++) {
      const key = visibleLogs[index].sourceFile;
      if (indices[key] === undefined) indices[key] = index;
    }
    return indices;
  }, [visibleLogs, isMergedView]);

  // Use Custom Hook for Search
  const matchIndices = useLogSearch(visibleLogs, searchQuery, isRegex);

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

  // Calculate active match log index for highlighting
  const activeMatchLogIndex = useMemo(() => {
    if (matchIndices.length === 0) return -1;
    return matchIndices[Math.abs(currentMatchIndex) % matchIndices.length];
  }, [matchIndices, currentMatchIndex]);

  // Scroll to active match
  useEffect(() => {
    if (activeMatchLogIndex !== -1) {
      virtuosoRef.current?.scrollToIndex({
        index: activeMatchLogIndex,
        align: "center",
        behavior: "auto"
      });
    }
  }, [activeMatchLogIndex]);

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
      <div className="flex-1 overflow-hidden relative bg-background flex flex-col min-w-0">
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b bg-muted/30 shrink-0">
          <Tag>{deviceInfo.board || "Unknown board"}</Tag>
          <Tag>{deviceInfo.version || "Unknown version"}</Tag>
          <Tag>ARC {deviceInfo.arcStatus || "unknown"}</Tag>

          <div className="h-4 w-px bg-border mx-1" />

          <button
            type="button"
            onClick={() => setIsMergedView(!isMergedView)}
            className={cn(
              "h-6 px-2 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors border",
              isMergedView
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted"
            )}
            title="Interleave every section on one timeline"
          >
            <Clock className="size-3" />
            Timeline
          </button>
        </div>

        <TimelineStrip logs={allLogs} />

        <div className="px-2 py-1.5 border-b bg-background shrink-0">
          <FilterBar
            levelCounts={levelCounts}
            processes={processes}
            visibleCount={visibleLogs.length}
            totalCount={allLogs.length}
          />
        </div>

        <LogList
          logs={visibleLogs}
          fileIndices={fileIndices}
          activeFile={activeFile}
          onActiveFileChange={setActiveFile}
          isMergedView={isMergedView}
          expandedIds={expandedIds}
          onToggleExpand={toggleExpand}
          searchQuery={searchQuery}
          isRegex={isRegex}
          virtuosoRef={virtuosoRef}
          highlightedIndex={activeMatchLogIndex}
        />

        <SearchResultsPanel
          logs={visibleLogs}
          matchIndices={matchIndices}
          activeMatchIndex={activeMatchLogIndex}
          isOpen={isResultsOpen}
          onToggle={() => setIsResultsOpen(!isResultsOpen)}
          onJumpTo={(index) =>
            virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "auto" })
          }
        />
      </div>
    </div>
  );
}
