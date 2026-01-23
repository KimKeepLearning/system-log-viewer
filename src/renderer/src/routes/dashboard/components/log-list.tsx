import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { LogRow } from "@renderer/components/log-viewer-shared";
import { ExtendedLog } from "../types";
import { cn } from "@renderer/lib/utils";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent
} from "@renderer/components/ui/collapsible";
import { Badge } from "@renderer/components/ui/badge";

interface LogListProps {
  logs: ExtendedLog[];
  fileIndices: Record<string, number>;
  activeFile: string | null;
  onActiveFileChange: (file: string) => void;
  isMergedView: boolean;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  searchQuery: string;
  isRegex: boolean;
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  highlightedIndex?: number;
}

export const LogList = ({
  logs,
  fileIndices,
  activeFile,
  onActiveFileChange,
  isMergedView,
  expandedIds,
  onToggleExpand,
  searchQuery,
  isRegex,
  virtuosoRef,
  highlightedIndex
}: LogListProps) => {
  if (logs.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm flex flex-col items-center gap-2 mt-20">
        <span className="text-4xl">🗂️</span>
        <p>No log sections selected.</p>
        <p className="opacity-60">Import a log file to view logs.</p>
      </div>
    );
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={logs}
      rangeChanged={({ startIndex }) => {
        const log = logs[startIndex];
        if (log && log.sourceFile !== activeFile) {
          onActiveFileChange(log.sourceFile);
        }
      }}
      className="h-[calc(100vh-140px)] scrollbar-container "
      itemContent={(index, log) => {
        // Highlight specific logs in merged view
        // chrome_user_log, chrome_system_log and their PREVIOUS variants
        const sectionName = log.sourceFile.split("::").slice(1).join("::") || log.sourceFile;
        const isPriorityLog = [
          "chrome_user_log",
          "chrome_user_log.PREVIOUS",
          "chrome_system_log",
          "chrome_system_log.PREVIOUS",
        ].includes(sectionName);

        return (
          <>
            {fileIndices[log.sourceFile] === index && (
              <div className="bg-muted/50 px-4 py-1.5 font-bold text-xs border-b border-border/50 flex items-center gap-2 sticky top-0 z-10 backdrop-blur-sm shadow-sm">
                <div className="w-1 h-3 bg-primary rounded-full"></div>
                {/* Show both File Name and Section Name if different
                     log.sourceFile is "FileName::SectionName"
                  */}
                {log.sourceFile.includes("::") ? (
                  <>
                    <span className="opacity-60 font-normal">{log.sourceFile.split("::")[0]}</span>
                    <span className="opacity-40 font-light">/</span>
                    <span>{sectionName}</span>
                  </>
                ) : (
                  log.sourceFile
                )}
              </div>
            )}
            {/* Merged View Header Alternative: Show section inline if needed, or rely on row content */}
            {isMergedView && (
              <div
                className={cn(
                  "px-2 pt-1 text-[10px] font-mono flex items-center gap-1",
                  isPriorityLog
                    ? "text-primary font-bold opacity-100"
                    : "text-muted-foreground opacity-40 scale-90 origin-left"
                )}
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    isPriorityLog ? "bg-primary" : "bg-muted-foreground/50"
                  )}
                ></span>
                {sectionName}
              </div>
            )}
            {log.count > 1 ? (
              <Collapsible
                open={expandedIds.has(log.id)}
                onOpenChange={() => onToggleExpand(log.id)}
              >
                <div
                  className={cn(
                    "pl-2 flex border-b border-border/40 last:border-0 transition-colors flex-col",
                    isMergedView && isPriorityLog
                      ? "bg-primary/5 hover:bg-primary/10 border-l-2 border-l-primary"
                      : "hover:bg-muted/10",
                    highlightedIndex === index && "bg-yellow-100"
                  )}
                >
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
              <div
                className={cn(
                  "pl-2 flex border-b border-border/40 last:border-0 transition-colors flex-col",
                  isMergedView && isPriorityLog
                    ? "bg-primary/5 hover:bg-primary/10 border-l-2 border-l-primary"
                    : "hover:bg-muted/10"
                )}
              >
                <div
                  className={cn(
                    "flex-1 min-w-0 flex items-start pr-2 hover:bg-fill-component-navigation",
                    highlightedIndex === index && "bg-yellow-100"
                  )}
                >
                  <LogRow log={log} query={searchQuery} isRegex={isRegex} />
                </div>
              </div>
            )}
          </>
        );
      }}
    />
  );
};
