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
  clearFiltersAtom,
  searchModeAtom,
  timeRangeAtom,
  aiMarksAtom,
  aiPanelOpenAtom,
  sectionFilterAtom,
  sectionMapsAtom
} from "@renderer/lib/atom";
import { extractLogSection, parseDeviceInfo } from "@renderer/lib/log-parser";
import { hierarchyKindOf } from "@renderer/lib/ui-hierarchy";
import { highlightPatterns, parseQuery } from "@renderer/lib/log-query";
import { looksLikeHistograms } from "@renderer/lib/log-histograms";
import { sectionNameOf } from "@renderer/lib/log-domains";
import { vmlogSeries } from "@renderer/lib/log-memory";
import { bookmarksAtom } from "@renderer/lib/bookmarks";
import { findCrashes } from "@renderer/lib/log-crashes";
import {
  detectBootSessions,
  lifecycleEvents,
  timelineEvents,
  type TimelineEvent
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
import { useMcpBridge } from "./hooks/use-mcp-bridge";
import { FileSidebar } from "./components/file-sidebar";
import { FilterBar } from "./components/filter-bar";
import { TimelineStrip, type TimelineMark } from "./components/timeline-strip";
import { SearchResultsPanel } from "./components/search-results-panel";
import { LogList } from "./components/log-list";
import { CompareView } from "./components/compare-view";
import { AiPanel } from "./components/ai-panel";
import type { Evidence } from "@renderer/lib/log-diff";
import type { AiMark } from "@renderer/lib/ai-tools";
import type { IUserLog } from "@renderer/lib/typings";
import { ExtendedLog } from "./types";

export const Route = createFileRoute("/dashboard/main")({
  component: RouteComponent
});

function RouteComponent() {
  const logStructure = useAtomValue(logStructureAtom);
  const logKeys = useAtomValue(logKeysAtom);
  const parsedLogs = useAtomValue(parsedLogsMapAtom);
  const logFiles = useAtomValue(logFilesAtom);
  const logTools = useMcpBridge();

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
  const [view, setView] = useState<"overview" | "log" | "compare">("overview");
  const [pendingScrollIndex, setPendingScrollIndex] = useState<number | null>(null);
  const [pendingTag, setPendingTag] = useState<string | null>(null);
  const [pendingLog, setPendingLog] = useState<ExtendedLog | null>(null);
  const [pendingTarget, setPendingTarget] = useState<{
    sourceFile: string;
    matches: (log: ExtendedLog) => boolean;
  } | null>(null);
  const aiMarks = useAtomValue(aiMarksAtom);
  const aiPanelOpen = useAtomValue(aiPanelOpenAtom);
  // Mounted on first open and then only hidden, so an investigation keeps
  // running while the panel is out of the way.
  const [aiPanelMounted, setAiPanelMounted] = useState(false);
  useEffect(() => {
    if (aiPanelOpen) setAiPanelMounted(true);
  }, [aiPanelOpen]);
  const [flash, setFlash] = useState<{ index: number; token: number } | null>(null);

  const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom);
  const setSectionFilter = useSetAtom(sectionFilterAtom);
  const parsedQuery = useMemo(() => parseQuery(searchQuery), [searchQuery]);
  const patterns = useMemo(() => highlightPatterns(parsedQuery), [parsedQuery]);
  const setMatchesCount = useSetAtom(searchMatchesCountAtom);
  const clearFilters = useSetAtom(clearFiltersAtom);
  const [searchMode, setSearchMode] = useAtom(searchModeAtom);
  const setTimeRange = useSetAtom(timeRangeAtom);
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
  const sectionMaps = useAtomValue(sectionMapsAtom);
  const bootSessions = useMemo(() => detectBootSessions(allLogs), [allLogs]);
  const events = useMemo(() => {
    // Each crash gets its own mark: a rule marks only its first hit, and the
    // second crash is often the one that matters.
    const crashes = findCrashes(allLogs, sectionMaps[selectedFileName ?? ""] ?? new Map())
      .filter((crash) => crash.ts !== null)
      .slice(0, 20)
      .map((crash) => ({
        ts: crash.ts as number,
        label: crash.title,
        kind: "problem" as const,
        severity: "critical" as const,
        log: crash.logIndex !== undefined ? allLogs[crash.logIndex] : undefined
      }));
    return [
      ...timelineEvents(bootSessions, runRules(allLogs), lifecycleEvents(allLogs)),
      ...crashes
    ].sort((a, b) => a.ts - b.ts);
  }, [allLogs, bootSessions, selectedFileName, sectionMaps]);

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

  // Picking a tag in the sidebar filtered the list but left you wherever you
  // were, which on a long file looked like nothing had happened.
  const focusTag = useCallback((tag: string) => {
    setHierarchyKey(null);
    setView("log");
    setPendingTag(tag);
  }, []);

  useEffect(() => {
    if (pendingTag === null || view !== "log") return;
    const index = visibleLogs.findIndex((log) => log.tag === pendingTag);
    if (index >= 0) {
      virtuosoRef.current?.scrollToIndex({ index, align: "start" });
      setFlash({ index, token: Date.now() });
    }
    setPendingTag(null);
  }, [pendingTag, view, visibleLogs]);

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

  const showInFullLog = useCallback(
    (log: ExtendedLog) => {
      clearFilters();
      if (searchMode === "filter") setSearchMode("highlight");
      setPendingLog(log);
    },
    [clearFilters, searchMode, setSearchMode]
  );

  // Declared after the active-match scroll so it wins when clearing the
  // filters also moves the current search match.
  useEffect(() => {
    if (pendingLog === null || visibleLogs !== allLogs) return;
    const index = allLogs.indexOf(pendingLog);
    if (index >= 0) {
      virtuosoRef.current?.scrollToIndex({ index, align: "center" });
      setFlash({ index, token: Date.now() });
    }
    setPendingLog(null);
  }, [pendingLog, visibleLogs, allLogs]);

  const jumpTo = useCallback(
    (sourceFile: string, matches: (log: ExtendedLog) => boolean) => {
      setHierarchyKey(null);
      setView("log");
      const fileName = sourceFile.split("::")[0];
      if (!isMergedView && fileName !== selectedFileName) setSelectedFileName(fileName);
      setPendingTarget({ sourceFile, matches });
    },
    [isMergedView, selectedFileName]
  );

  // The toast's way out. Clearing only the facet filters left a search filter
  // hiding the line, and nothing scrolled to it once it was back.
  const revealLine = useCallback(
    (sourceFile: string, matches: (log: ExtendedLog) => boolean) => {
      clearFilters();
      setSearchMode("highlight");
      setPendingTarget({ sourceFile, matches });
    },
    [clearFilters, setSearchMode]
  );

  // The comparison was built from the raw sections, not these rows, so the line
  // is found again by section and text rather than by identity.
  const jumpToEvidence = useCallback(
    (evidence: Evidence) =>
      jumpTo(
        evidence.sourceFile,
        (log) => log.sourceFile === evidence.sourceFile && log.message === evidence.message
      ),
    [jumpTo]
  );

  const jumpToLine = useCallback(
    (key: string, index: number) => {
      const raw = parsedLogs[key]?.[index];
      if (raw) jumpTo(key, (log) => log.raw === raw || log.duplicates.includes(raw));
    },
    [jumpTo, parsedLogs]
  );

  useEffect(() => {
    if (pendingTarget === null || view !== "log") return;
    if (!isMergedView && pendingTarget.sourceFile.split("::")[0] !== selectedFileName) return;
    const index = visibleLogs.findIndex(pendingTarget.matches);
    if (index >= 0) {
      virtuosoRef.current?.scrollToIndex({ index, align: "center" });
      setFlash({ index, token: Date.now() });
    } else if (allLogs.some(pendingTarget.matches)) {
      const { sourceFile, matches } = pendingTarget;
      toast.info("That line is hidden by the current filters", {
        action: { label: "Clear filters", onClick: () => revealLine(sourceFile, matches) }
      });
    }
    setPendingTarget(null);
  }, [pendingTarget, view, isMergedView, selectedFileName, visibleLogs, allLogs, revealLine]);

  // Merged rows are in time order, so the first row at or after the moment is
  // the answer. Sequential rows are grouped by section; there the section being
  // read is searched first, and the whole file only if it does not cover the moment.
  // With a section (its lane was clicked), the nearest line of that section
  // wins wherever it sits.
  const jumpToTime = useCallback(
    (ts: number, section?: string) => {
      let index = -1;
      const closest = (accept: (log: ExtendedLog) => boolean) => {
        let best = -1;
        let bestDistance = Infinity;
        let first = Infinity;
        let last = -Infinity;
        for (let i = 0; i < visibleLogs.length; i++) {
          const log = visibleLogs[i];
          if (log.tsKind !== "wall" || typeof log.ts !== "number" || !accept(log)) continue;
          first = Math.min(first, log.ts);
          last = Math.max(last, log.ts);
          const distance = Math.abs(log.ts - ts);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
          }
        }
        return { best, covers: ts >= first && ts <= last };
      };

      if (section) {
        index = closest((log) => log.sourceFile === section).best;
      } else if (isMergedView) {
        let low = 0;
        let high = visibleLogs.length;
        while (low < high) {
          const mid = (low + high) >> 1;
          if ((visibleLogs[mid].ts as number) < ts) low = mid + 1;
          else high = mid;
        }
        index = Math.min(low, visibleLogs.length - 1);
      } else {
        const inSection = activeFile ? closest((log) => log.sourceFile === activeFile) : null;
        index = inSection?.covers ? inSection.best : closest(() => true).best;
      }
      if (index < 0) return;
      virtuosoRef.current?.scrollToIndex({ index, align: "center" });
      setFlash({ index, token: Date.now() });
    },
    [isMergedView, visibleLogs, activeFile]
  );

  // In filter mode every visible row is a match; in highlight mode only the
  // indices the search found.
  const hitIndices = useMemo(() => {
    if (parsedQuery.isEmpty) return [];
    return searchMode === "filter" ? visibleLogs.map((_, index) => index) : matchIndices;
  }, [parsedQuery, searchMode, visibleLogs, matchIndices]);

  const hitTimes = useMemo(() => {
    const times: number[] = [];
    for (const index of hitIndices) {
      const log = visibleLogs[index];
      if (log.tsKind === "wall" && typeof log.ts === "number") times.push(log.ts);
    }
    return times;
  }, [hitIndices, visibleLogs]);

  const jumpToHit = useCallback(
    (ts: number) => {
      let best = -1;
      let bestDistance = Infinity;
      for (const index of hitIndices) {
        const log = visibleLogs[index];
        if (log.tsKind !== "wall" || typeof log.ts !== "number") continue;
        const distance = Math.abs(log.ts - ts);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
      if (best < 0) return;
      virtuosoRef.current?.scrollToIndex({ index: best, align: "center" });
      setFlash({ index: best, token: Date.now() });
    },
    [hitIndices, visibleLogs]
  );

  const bookmarks = useAtomValue(bookmarksAtom);
  const timelineMarks = useMemo(() => {
    const result: TimelineMark[] = [];
    for (const mark of aiMarks) {
      const raw = parsedLogs[mark.key]?.[mark.index];
      if (raw?.tsKind !== "wall" || typeof raw.ts !== "number") continue;
      result.push({
        ts: raw.ts,
        kind: mark.kind,
        label: mark.note || raw.message,
        onSelect: () => jumpToLine(mark.key, mark.index)
      });
    }
    for (const bookmark of bookmarks) {
      if (bookmark.ts === null || !bookmark.sourceFile.startsWith(`${selectedFileName}::`))
        continue;
      result.push({
        ts: bookmark.ts,
        kind: "bookmark",
        label: bookmark.note || bookmark.message,
        onSelect: () =>
          jumpTo(
            bookmark.sourceFile,
            (log) =>
              log.sourceFile === bookmark.sourceFile &&
              log.message === bookmark.message &&
              (log.ts ?? null) === bookmark.ts
          )
      });
    }
    return result;
  }, [aiMarks, bookmarks, parsedLogs, selectedFileName, jumpTo, jumpToLine]);

  const resourceSeries = useMemo(() => {
    const sections = sectionMaps[selectedFileName ?? ""];
    if (!sections) return null;
    let reference = 0;
    for (const log of allLogs) {
      if (log.tsKind === "wall" && typeof log.ts === "number" && log.ts > reference) {
        reference = log.ts;
      }
    }
    return reference > 0 ? vmlogSeries(sections, reference) : null;
  }, [sectionMaps, selectedFileName, allLogs]);

  const pinnedSectionSet = useAtomValue(sectionFilterAtom);
  const pinnedSections = useMemo(() => [...pinnedSectionSet], [pinnedSectionSet]);

  const selectEvent = useCallback(
    (event: TimelineEvent) => {
      const line = event.log as ExtendedLog | undefined;
      if (line) {
        jumpTo(line.sourceFile, (row) => row === line);
        return;
      }
      jumpToTime(event.ts);
    },
    [jumpTo, jumpToTime]
  );

  const marksByLine = useMemo(() => {
    const map = new Map<IUserLog, AiMark>();
    for (const mark of aiMarks) {
      const raw = parsedLogs[mark.key]?.[mark.index];
      if (raw) map.set(raw, mark);
    }
    return map;
  }, [aiMarks, parsedLogs]);

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
        tags={tagFacets}
        onSelectFile={setSelectedFileName}
        onScrollToSection={scrollToSection}
        onFocusTag={focusTag}
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
                {(["overview", "log", "compare"] as const).map((option) => (
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

            {view === "compare" ? (
              <CompareView onJumpToEvidence={jumpToEvidence} />
            ) : view === "overview" ? (
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
                    setFlash({ index, token: Date.now() });
                  } else {
                    // The evidence exists but the active filters hide it, which
                    // would otherwise look like the jump silently doing nothing.
                    toast.info("That line is hidden by the current filters", {
                      action: {
                        label: "Clear filters",
                        onClick: () => revealLine(log.sourceFile, (row) => row === log)
                      }
                    });
                  }
                }}
                onShowSession={(session) => {
                  setTimeRange({ from: session.startTs, to: session.lastTs });
                  setView("log");
                }}
                onShowSection={(section) => {
                  if (selectedFileName) scrollToSection(`${selectedFileName}::${section}`);
                }}
                onShowMerged={(keys) => {
                  clearFilters();
                  setSectionFilter(new Set(keys));
                  setIsMergedView(true);
                  setView("log");
                }}
                onShowTime={(ts) => {
                  // A vmlog sample covers a couple of seconds; a minute either
                  // side shows what led up to the peak and what followed.
                  setTimeRange({ from: ts - 60_000_000, to: ts + 60_000_000 });
                  setIsMergedView(true);
                  setView("log");
                }}
                onSearch={(phrase, mergeable) => {
                  clearFilters();
                  setSearchQuery(`"${phrase}"`);
                  setSearchMode("filter");
                  setIsMergedView(mergeable);
                  setView("log");
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

                <TimelineStrip
                  logs={allLogs}
                  events={events}
                  sessions={bootSessions}
                  hits={hitTimes}
                  marks={timelineMarks}
                  resource={resourceSeries}
                  pinnedSections={pinnedSections}
                  onJumpToTime={jumpToTime}
                  onJumpToHit={jumpToHit}
                  onSelectEvent={selectEvent}
                />

                {/* Filters only: Merge is a view mode and sits with the view
                    switch, so this line never has to wrap. */}
                <div className="px-2 py-1.5 border-b bg-background shrink-0 flex items-center gap-1.5">
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
                  flash={flash}
                  onShowInFullLog={visibleLogs !== allLogs ? showInFullLog : undefined}
                  marks={marksByLine}
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

      {aiPanelMounted && (
        <AiPanel hidden={!aiPanelOpen} onJumpToLine={jumpToLine} logTools={logTools} />
      )}
    </div>
  );
}
