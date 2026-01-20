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
import { useMemo, useRef, useState, useEffect } from "react";
import { LogRow } from "@renderer/components/log-viewer-shared";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { ScrollArea } from "@renderer/components/ui/scroll-area";
import { cn } from "@renderer/lib/utils";
import { IUserLog } from "@renderer/lib/typings";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent
} from "@renderer/components/ui/collapsible";
import { Badge } from "@renderer/components/ui/badge";
import { ChevronRight, ChevronDown } from "lucide-react";

export const Route = createFileRoute("/dashboard/main")({
  component: RouteComponent
});

interface ExtendedLog extends IUserLog {
  sourceFile: string;
  count: number;
  id: string;
  duplicates: IUserLog[];
}

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

  // Flatten logs efficiently and keep track of start indices
  const { allLogs, fileIndices } = useMemo(() => {
    if (!selectedFileName) return { allLogs: [], fileIndices: {} };

    const flatLogs: ExtendedLog[] = [];
    const indices: Record<string, number> = {};

    // Only process sections for the selected file
    const keysToProcess = logStructure[selectedFileName] || [];

    keysToProcess.forEach((key) => {
      indices[key] = flatLogs.length;
      const logs = parsedLogs[key] || [];

      for (let i = 0; i < logs.length; i++) {
        const currentHook = logs[i];
        const lastLog = flatLogs.length > indices[key] ? flatLogs[flatLogs.length - 1] : null;

        // Simple folding logic: same message, level, process
        if (
          lastLog &&
          lastLog.message === currentHook.message &&
          lastLog.level === currentHook.level &&
          lastLog.process === currentHook.process &&
          lastLog.sourceFile === key
        ) {
          lastLog.count++;
          lastLog.duplicates.push(currentHook);
        } else {
          flatLogs.push({
            ...currentHook,
            sourceFile: key,
            count: 1,
            duplicates: [],
            id: `${key}-${i}`
          });
        }
      }
    });

    return { allLogs: flatLogs, fileIndices: indices };
  }, [logStructure, parsedLogs, selectedFileName]);

  // Handle pending scroll after view update
  useEffect(() => {
    if (pendingScrollKey && fileIndices[pendingScrollKey] !== undefined) {
      virtuosoRef.current?.scrollToIndex({ index: fileIndices[pendingScrollKey], align: "start" });
      setPendingScrollKey(null);
    }
  }, [pendingScrollKey, fileIndices]);

  const scrollToSection = (key: string) => {
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
  };

  // Sidebar File Item Component (Internal)
  const FileItem = ({ fileName, sections }: { fileName: string; sections: string[] }) => {
    const [isOpen, setIsOpen] = useState(true); // Default expanded

    return (
      <div className="mb-1">
        <div
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-fill-component-navigation transition-colors group select-none cursor-pointer"
          )}
          onClick={() => {
            // Select file and scroll to start
            if (fileName !== selectedFileName) {
              setSelectedFileName(fileName);
            }
            if (sections.length > 0) {
              // Optional: Scroll to first section if switching file?
              // Since switching file essentially resets the view to the top, it should be automatic.
            }
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
            className="p-0.5 hover:bg-fill-interaction-subtle-hover rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>

          <span className="text-sm font-semibold truncate flex-1" title={fileName}>
            {fileName}
          </span>
          <Badge variant="outline" className="text-[10px] h-5 px-1 ml-auto">
            {sections.length}
          </Badge>
        </div>

        {isOpen && (
          <div className="ml-6 pl-2 border-l border-border/20 flex flex-col gap-0.5 mt-1">
            {sections.map((sectionKey) => {
              // sectionKey is "FileName::SectionName"
              // We display only "SectionName"
              const parts = sectionKey.split("::");
              const displayName = parts.length > 1 ? parts.slice(1).join("::") : sectionKey;

              const isActive =
                activeFile === sectionKey ||
                (selectedFileName === fileName && sectionKey === activeFile);

              return (
                <div
                  key={sectionKey}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1 hover:bg-fill-component-navigation transition-colors cursor-pointer",
                    isActive && "bg-fill-component-navigation text-primary"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    scrollToSection(sectionKey);
                  }}
                >
                  <span
                    className={cn(
                      "text-xs text-left truncate flex-1 opacity-80 hover:opacity-100",
                      isActive && "font-medium opacity-100"
                    )}
                    title={displayName}
                  >
                    {displayName}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Search Match Logic
  const matchIndices = useMemo(() => {
    if (!searchQuery) return [];

    const indices: number[] = [];
    const queryLower = searchQuery.toLowerCase();

    let regex: RegExp | null = null;
    if (isRegex) {
      try {
        regex = new RegExp(searchQuery, "i");
      } catch {
        // invalid regex
      }
    }

    allLogs.forEach((log, index) => {
      // Build a search string similar to what the user sees
      const content = [log.timestamp, log.level, log.process, log.source, log.message]
        .filter(Boolean)
        .join(" ");

      if (regex) {
        if (regex.test(content)) indices.push(index);
      } else {
        if (content.toLowerCase().includes(queryLower)) indices.push(index);
      }
    });
    return indices;
  }, [allLogs, searchQuery, isRegex]);

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
      {/* Sidebar Anchors */}
      <div className="w-64 border-r bg-muted/20 shrink-0 flex flex-col">
        <div className="p-3 bg-muted/30 font-semibold text-sm border-b flex items-center justify-between">
          <span>Log Files ({allFiles.length})</span>
        </div>
        <ScrollArea className="h-[calc(100vh-140px)] scrollbar-container ">
          <div className="p-2 flex flex-col gap-1">
            {allFiles.map((fileName) => (
              <FileItem key={fileName} fileName={fileName} sections={logStructure[fileName]} />
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden relative bg-background">
        <div className="flex items-center gap-1">
          <Tag>Board: {deviceInfo.board}</Tag>
          <Tag>OS Version: {deviceInfo.version}</Tag>
          <Tag>ARC Status: {deviceInfo.arcStatus}</Tag>
        </div>
        {allLogs.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm flex flex-col items-center gap-2 mt-20">
            <span className="text-4xl">🗂️</span>
            <p>No log sections selected.</p>
            <p className="opacity-60">Import a log file to view logs.</p>
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={allLogs}
            rangeChanged={({ startIndex }) => {
              const log = allLogs[startIndex];
              if (log && log.sourceFile !== activeFile) {
                setActiveFile(log.sourceFile);
              }
            }}
            className="h-[calc(100vh-140px)] scrollbar-container "
            itemContent={(index, log) => (
              <>
                {fileIndices[log.sourceFile] === index && (
                  <div className="bg-muted/50 px-4 py-1.5 font-bold text-xs border-b border-border/50 flex items-center gap-2 sticky top-0 z-10 backdrop-blur-sm shadow-sm">
                    <div className="w-1 h-3 bg-primary rounded-full"></div>
                    {/* Show both File Name and Section Name if different
                     log.sourceFile is "FileName::SectionName"
                  */}
                    {log.sourceFile.includes("::") ? (
                      <>
                        <span className="opacity-60 font-normal">
                          {log.sourceFile.split("::")[0]}
                        </span>
                        <span className="opacity-40 font-light">/</span>
                        <span>{log.sourceFile.split("::").slice(1).join("::")}</span>
                      </>
                    ) : (
                      log.sourceFile
                    )}
                  </div>
                )}
                {log.count > 1 ? (
                  <Collapsible
                    open={expandedIds.has(log.id)}
                    onOpenChange={() => toggleExpand(log.id)}
                  >
                    <div className="pl-2 flex border-b border-border/40 last:border-0 hover:bg-muted/10 transition-colors flex-col">
                      <LogRow log={log} query={searchQuery} isRegex={isRegex}>
                        <CollapsibleTrigger asChild>
                          <Badge
                            variant="secondary"
                            className="ml-2 cursor-pointer h-5 px-1.5 min-w-8 justify-center bg-fill-interaction-secondary hover:bg-fill-interaction-secondary-hover inline-flex align-middle"
                          >
                            x{log.count}
                          </Badge>
                        </CollapsibleTrigger>
                      </LogRow>
                      <CollapsibleContent>
                        {log.duplicates.length > 0 && (
                          <div className="bg-muted/5 border-t border-border/30">
                            {log.duplicates.map((dup, i) => (
                              <div key={i} className="relative">
                                {/* Connecting line visual */}
                                <div className="border-b border-border/20 last:border-0">
                                  <LogRow
                                    log={dup}
                                    query={searchQuery}
                                    isRegex={isRegex}
                                    isMain={false}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                ) : (
                  <div className="pl-2 flex border-b border-border/40 last:border-0 hover:bg-muted/10 transition-colors flex-col">
                    <div className="flex-1 min-w-0 flex items-start pr-2">
                      <div className="flex-1 min-w-0">
                        <LogRow log={log} query={searchQuery} isRegex={isRegex} />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          />
        )}
      </div>
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
