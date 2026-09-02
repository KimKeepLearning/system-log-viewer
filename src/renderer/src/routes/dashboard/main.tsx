import { createFileRoute } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  logStructureAtom,
  logKeysAtom,
  parsedLogsMapAtom,
  searchQueryAtom,
  searchMatchesCountAtom,
  currentMatchIndexAtom,
  logFilesAtom,
  clearFiltersAtom
} from "@renderer/lib/atom";
import { extractLogSection, parseDeviceInfo } from "@renderer/lib/log-parser";
import { hierarchyKindOf } from "@renderer/lib/ui-hierarchy";
import { highlightPatterns, parseQuery } from "@renderer/lib/log-query";
import { looksLikeHistograms } from "@renderer/lib/log-histograms";
import { sectionNameOf } from "@renderer/lib/log-domains";
import {
  captureTime,
  detectBootSessions,
  lifecycleEvents,
  timelineEvents
} from "@renderer/lib/log-analysis";
import { runRules } from "@renderer/lib/log-rules";
import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { VirtuosoHandle } from "react-virtuoso";
import { Clock } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { toast } from "sonner";

import { SearchBar } from "./components/search-bar";
import { CommandPalette } from "./components/command-palette";
import { OverviewPanel } from "./components/overview-panel";
import { MetricsView } from "./components/metrics-view";
import { HierarchyView } from "./components/hierarchy-view";
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
  const [hierarchyKey, setHierarchyKey] = useState<string | null>(null);
  // What the log says comes before the log itself, so this is where you land.
  const [view, setView] = useState<"overview" | "log">("overview");
  const [pendingScrollIndex, setPendingScrollIndex] = useState<number | null>(null);

  const [searchQuery] = useAtom(searchQueryAtom);
  const parsedQuery = useMemo(() => parseQuery(searchQuery), [searchQuery]);
  const patterns = useMemo(() => highlightPatterns(parsedQuery), [parsedQuery]);
  const setMatchesCount = useSetAtom(searchMatchesCountAtom);
  const clearFilters = useSetAtom(clearFiltersAtom);
  const [currentMatchIndex] = useAtom(currentMatchIndexAtom);
  // histograms.txt is a table of distributions, not a log; rendering it in the
  // log list produced one unreadable row of JSON.
  const metricsContent = useMemo(() => {
    const file = logFiles.find((entry) => entry.name === selectedFileName);
    if (!file || file.imageDataUrl) return null;
    return looksLikeHistograms(file.content) ? file.content : null;
  }, [logFiles, selectedFileName]);

  const hierarchy = useMemo(() => {
    if (!hierarchyKey) return null;
    const sectionName = sectionNameOf(hierarchyKey);
    const kind = hierarchyKindOf(sectionName);
    const file = logFiles.find((entry) => entry.name === hierarchyKey.split("::")[0]);
    if (!kind || !file) return null;
    return { kind, sectionName, content: extractLogSection(file.content, sectionName) };
  }, [hierarchyKey, logFiles]);

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

  const {
    logs: visibleLogs,
    processes,
    tags: tagFacets,
    levelCounts
  } = useLogFilter(allLogs, parsedQuery);

  // Section names for the search bar's section: completion.
  const sectionNames = useMemo(
    () => (logStructure[selectedFileName ?? ""] ?? []).map(sectionNameOf),
    [logStructure, selectedFileName]
  );
  // Boots and the first occurrence of each consequential finding, marked on
  // the strip so the shape of the session is readable at a glance.
  const events = useMemo(() => {
    const file = logFiles.find((entry) => entry.name === selectedFileName);
    const capturedAt = file ? captureTime(extractLogSection(file.content, "LOGDATE")) : null;
    const sessions = detectBootSessions(allLogs);
    return timelineEvents(sessions, runRules(allLogs), lifecycleEvents(allLogs), capturedAt);
  }, [allLogs, logFiles, selectedFileName]);

  const tagNames = useMemo(() => tagFacets.map((tag) => tag.name), [tagFacets]);

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

  useEffect(() => {
    if (pendingScrollIndex === null || view !== "log") return;
    virtuosoRef.current?.scrollToIndex({ index: pendingScrollIndex, align: "center" });
    setPendingScrollIndex(null);
  }, [pendingScrollIndex, view]);

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
      // The three hierarchy sections are trees, not runs of lines; scrolling to
      // them in the log list only ever showed their indentation.
      if (hierarchyKindOf(sectionNameOf(key))) {
        setHierarchyKey(key);
        return;
      }
      setHierarchyKey(null);
      // Picking a section means you want to read it.
      setView("log");

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
        ) : hierarchy ? (
          <>
            <div className="px-2 py-1.5 border-b flex items-center gap-2 shrink-0">
              <span className="text-sm font-semibold truncate">{hierarchy.sectionName}</span>
              <button
                type="button"
                onClick={() => setHierarchyKey(null)}
                className="ml-auto h-6 px-2 rounded-md text-xs text-muted-foreground hover:bg-muted shrink-0"
              >
                Show as log
              </button>
            </div>
            <HierarchyView content={hierarchy.content} kind={hierarchy.kind} />
          </>
        ) : (
          <>
            {/* One switch, always in the same place, so neither view is buried. */}
            <div className="px-2 py-1.5 border-b bg-background shrink-0 flex items-center gap-2">
              <div className="flex rounded-md border p-0.5 shrink-0">
                {(["overview", "log"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setView(option)}
                    className={cn(
                      "h-5 px-2.5 rounded text-xs font-medium capitalize transition-colors",
                      view === option
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>

              {view === "log" && (
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
              )}

              {view === "log" && (
                <SearchBar
                  parsed={parsedQuery}
                  matchCount={matchIndices.length}
                  processes={processes}
                  sections={sectionNames}
                  levels={levelNames}
                  tags={tagNames}
                  inputRef={searchInputRef}
                />
              )}
            </div>

            {view === "overview" ? (
              <OverviewPanel
                logs={allLogs}
                fileName={selectedFileName}
                onJumpToLog={(log) => {
                  setView("log");
                  const index = visibleLogs.indexOf(log);
                  if (index >= 0) {
                    // Handed to an effect rather than a timeout: the list is
                    // still unmounted at this point, so there is nothing to
                    // scroll yet and virtuosoRef is null.
                    setPendingScrollIndex(index);
                  } else {
                    // The evidence exists but the active filters hide it, which
                    // would otherwise look like the jump silently doing nothing.
                    toast.info("That line is hidden by the current filters", {
                      action: { label: "Clear filters", onClick: () => clearFilters() }
                    });
                  }
                }}
              />
            ) : (
              <>
                <div className="hidden">
                  <SearchBar
                    parsed={parsedQuery}
                    matchCount={matchIndices.length}
                    processes={processes}
                    sections={sectionNames}
                    levels={levelNames}
                    tags={tagNames}
                    inputRef={searchInputRef}
                  />
                </div>

                <CommandPalette
                  sectionKeys={logStructure[selectedFileName ?? ""] ?? []}
                  onGoToSection={scrollToSection}
                  onFocusSearch={() => {
                    // The search box only exists in the log view.
                    setView("log");
                    window.setTimeout(() => searchInputRef.current?.focus(), 0);
                  }}
                  onToggleMerge={() => setIsMergedView((merged) => !merged)}
                />

                <TimelineStrip logs={allLogs} events={events} />

                {/* Filters only: Merge is a view mode and sits with the view
                    switch, so this line never has to wrap. */}
                <div className="px-2 py-1.5 border-b bg-background shrink-0 flex items-center gap-1.5">
                  <FilterBar
                    levelCounts={levelCounts}
                    processes={processes}
                    tags={tagFacets}
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
          </>
        )}
      </div>
    </div>
  );
}
