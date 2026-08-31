import { createFileRoute } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  logStructureAtom,
  logKeysAtom,
  parsedLogsMapAtom,
  searchQueryAtom,
  searchMatchesCountAtom,
  currentMatchIndexAtom,
  logFilesAtom
} from "@renderer/lib/atom";
import { parseDeviceInfo } from "@renderer/lib/log-parser";
import { highlightPatterns, parseQuery } from "@renderer/lib/log-query";
import { looksLikeHistograms } from "@renderer/lib/log-histograms";
import { sectionNameOf } from "@renderer/lib/log-domains";
import { detectBootSessions, lifecycleEvents, timelineEvents } from "@renderer/lib/log-analysis";
import { runRules } from "@renderer/lib/log-rules";
import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { VirtuosoHandle } from "react-virtuoso";
import { Clock } from "lucide-react";
import { cn } from "@renderer/lib/utils";

import { SearchBar } from "./components/search-bar";
import { CommandPalette } from "./components/command-palette";
import { OverviewDialog } from "./components/overview-dialog";
import { MetricsView } from "./components/metrics-view";
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

function RouteComponent() {
  const logStructure = useAtomValue(logStructureAtom);
  const logKeys = useAtomValue(logKeysAtom);
  const parsedLogs = useAtomValue(parsedLogsMapAtom);
  const logFiles = useAtomValue(logFilesAtom);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [pendingScrollKey, setPendingScrollKey] = useState<string | null>(null);
  const [isMergedView, setIsMergedView] = useState(false);
  const [isResultsOpen, setIsResultsOpen] = useState(false);

  const [searchQuery] = useAtom(searchQueryAtom);
  const parsedQuery = useMemo(() => parseQuery(searchQuery), [searchQuery]);
  const patterns = useMemo(() => highlightPatterns(parsedQuery), [parsedQuery]);
  const setMatchesCount = useSetAtom(searchMatchesCountAtom);
  const [currentMatchIndex] = useAtom(currentMatchIndexAtom);
  // histograms.txt is a table of distributions, not a log; rendering it in the
  // log list produced one unreadable row of JSON.
  const metricsContent = useMemo(() => {
    const file = logFiles.find((entry) => entry.name === selectedFileName);
    if (!file || file.imageDataUrl) return null;
    return looksLikeHistograms(file.content) ? file.content : null;
  }, [logFiles, selectedFileName]);

  // The device is a property of the archive, not of whichever file is open:
  // reading it from the selection made the header say "Unknown board" as soon
  // as you clicked histograms.txt, which carries no device fields.
  const deviceInfo = useMemo(() => {
    for (const file of logFiles) {
      if (file.imageDataUrl) continue;
      const info = parseDeviceInfo(file.content);
      if (info.board && info.board !== "unknown") return info;
    }
    return { board: undefined, version: undefined, arcStatus: undefined };
  }, [logFiles]);
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

  const { logs: visibleLogs, processes, levelCounts } = useLogFilter(allLogs, parsedQuery);

  // Section names for the search bar's section: completion.
  const sectionNames = useMemo(
    () => (logStructure[selectedFileName ?? ""] ?? []).map(sectionNameOf),
    [logStructure, selectedFileName]
  );
  // Boots and the first occurrence of each consequential finding, marked on
  // the strip so the shape of the session is readable at a glance.
  const events = useMemo(() => {
    const sessions = detectBootSessions(allLogs);
    return timelineEvents(sessions, runRules(allLogs), lifecycleEvents(allLogs));
  }, [allLogs]);

  const levelNames = useMemo(
    () => Object.keys(levelCounts).filter((name) => name !== "NONE"),
    [levelCounts]
  );

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
  const matchIndices = useLogSearch(visibleLogs, parsedQuery);

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
        deviceInfo={deviceInfo}
        onSelectFile={setSelectedFileName}
        onScrollToSection={scrollToSection}
      />

      {/* Main Content */}
      <div className="flex-1 overflow-hidden relative bg-background flex flex-col min-w-0">
        {metricsContent ? (
          <MetricsView content={metricsContent} />
        ) : (
          <>
            {/* Search sits with the list it searches rather than up in the title bar. */}
            <div className="px-2 py-1.5 border-b bg-background shrink-0">
              <SearchBar
                parsed={parsedQuery}
                matchCount={matchIndices.length}
                processes={processes}
                sections={sectionNames}
                levels={levelNames}
                inputRef={searchInputRef}
              />
            </div>

            <CommandPalette
              sectionKeys={logStructure[selectedFileName ?? ""] ?? []}
              onGoToSection={scrollToSection}
              onFocusSearch={() => searchInputRef.current?.focus()}
              onToggleMerge={() => setIsMergedView((merged) => !merged)}
            />

            <TimelineStrip logs={allLogs} events={events} />

            <div className="px-2 py-1.5 border-b bg-background shrink-0 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsMergedView(!isMergedView)}
                className={cn(
                  "h-6 px-2 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors border shrink-0",
                  isMergedView
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted"
                )}
                title="Interleave every section on one timeline"
              >
                <Clock className="size-3" />
                Merge
              </button>

              <OverviewDialog
                logs={allLogs}
                fileName={selectedFileName}
                onJumpToLog={(log) => {
                  const index = visibleLogs.indexOf(log);
                  if (index >= 0) {
                    virtuosoRef.current?.scrollToIndex({ index, align: "center" });
                  }
                }}
              />

              <div className="h-4 w-px bg-border" />

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
              patterns={patterns}
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
          </>
        )}
      </div>
    </div>
  );
}
