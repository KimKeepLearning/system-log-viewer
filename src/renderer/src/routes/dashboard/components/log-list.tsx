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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from "@renderer/components/ui/context-menu";
import { buildLogText, countLogLines } from "@renderer/lib/log-utils";
import { sectionNameOf } from "@renderer/lib/log-domains";
import { bookmarkKey, bookmarkKeysAtom, toggleBookmarkAtom } from "@renderer/lib/bookmarks";
import { selectedTimeAtom } from "@renderer/lib/atom";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { rangeFromSelection, useCopyLogs } from "../hooks/use-copy-logs";
import { useLogSelection } from "../hooks/use-log-selection";

const CONTEXT_LINES = 20;

interface LogListProps {
  logs: ExtendedLog[];
  fileIndices: Record<string, number>;
  activeFile: string | null;
  onActiveFileChange: (file: string) => void;
  isMergedView: boolean;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  patterns: RegExp[];
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
  patterns,
  virtuosoRef,
  highlightedIndex
}: LogListProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { range, selectedCount, selectRow, selectRange, extendTo, isSelected } = useLogSelection();
  const handleCopy = useCopyLogs(logs, range);
  const bookmarkKeys = useAtomValue(bookmarkKeysAtom);
  const toggleBookmark = useSetAtom(toggleBookmarkAtom);
  const setSelectedTime = useSetAtom(selectedTimeAtom);

  // Selecting a row also points the timeline at it, so "where am I in the
  // session" is answered without reading a timestamp.
  const selectAndMark = useCallback(
    (index: number) => {
      selectRow(index);
      setSelectedTime(typeof logs[index]?.ts === "number" ? (logs[index].ts as number) : null);
    },
    [logs, selectRow, setSelectedTime]
  );

  // Sections this view holds, for "jump to this time in ...".
  const sectionKeys = useMemo(() => {
    const seen = new Set<string>();
    for (const log of logs) seen.add(log.sourceFile);
    return [...seen];
  }, [logs]);

  const copyLogs = useCallback((selected: ExtendedLog[], what: string) => {
    if (selected.length === 0) return;
    const lineCount = countLogLines(selected);
    navigator.clipboard
      .writeText(buildLogText(selected))
      .then(() => toast.success(`Copied ${lineCount.toLocaleString()} ${what}`))
      .catch((err) => toast.error(`Could not copy: ${err instanceof Error ? err.message : err}`));
  }, []);

  const handleRowClick = useCallback(
    (event: React.MouseEvent, index: number) => {
      // The fold badge and any other control owns its own click.
      if ((event.target as HTMLElement).closest("button")) return;

      if (event.shiftKey) {
        // The native shift-click extension was suppressed in onMouseDown, so
        // the row range is the only selection left to update.
        extendTo(index);
      } else {
        // A drag that produced a text selection should not also move the row
        // selection out from under it.
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
        selectAndMark(index);
      }

      // Cmd/Ctrl+C only reaches our handler if focus sits inside the container.
      containerRef.current?.focus({ preventScroll: true });
    },
    [extendTo, selectAndMark]
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      // Opening the menu collapses any text selection, so adopt it as a row
      // range first — otherwise a drag across rows is lost on right-click.
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        const fromSelection = rangeFromSelection(selection);
        if (fromSelection && fromSelection !== "native") {
          selectRange(fromSelection);
          return;
        }
      }

      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-log-index]");
      if (!row) return;
      const index = Number(row.dataset.logIndex);
      if (Number.isNaN(index)) return;

      // Right-clicking outside the current range moves the selection to it,
      // the way a file list does; inside it, the range is kept.
      if (!range || index < range.from || index > range.to) selectAndMark(index);
    },
    [range, selectRange, selectAndMark]
  );

  if (logs.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm flex flex-col items-center gap-2 mt-20">
        <span className="text-4xl">🗂️</span>
        <p>No log sections selected.</p>
        <p className="opacity-60">Import a log file to view logs.</p>
      </div>
    );
  }

  // Deliberately not materializing the selected rows here: the range can span
  // hundreds of thousands of entries and this component re-renders on scroll.
  const anchorLog = range ? logs[range.from] : undefined;
  const anchorSection = anchorLog?.sourceFile;

  const jumpTargets =
    anchorLog && typeof anchorLog.ts === "number"
      ? sectionKeys.filter((key) => key !== anchorSection).map((key) => ({ key }))
      : [];

  /**
   * Answers "the UI stalled here — what was the kernel doing?" by landing on
   * the first line of another section at or after the selected instant.
   */
  const jumpToSectionAtTime = (sectionKey: string) => {
    const target = anchorLog?.ts;
    if (typeof target !== "number") return;

    let best = -1;
    let bestDelta = Infinity;
    for (let index = 0; index < logs.length; index++) {
      const log = logs[index];
      if (log.sourceFile !== sectionKey || typeof log.ts !== "number") continue;
      const delta = Math.abs(log.ts - target);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = index;
      }
    }

    if (best === -1) {
      toast.error(`${sectionNameOf(sectionKey)} has nothing on the clock`);
      return;
    }

    selectAndMark(best);
    virtuosoRef.current?.scrollToIndex({ index: best, align: "center" });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={containerRef}
          tabIndex={-1}
          className="flex-1 min-h-0 outline-none"
          onCopy={handleCopy}
          onContextMenu={handleContextMenu}
        >
          <Virtuoso
            ref={virtuosoRef}
            data={logs}
            rangeChanged={({ startIndex }) => {
              const log = logs[startIndex];
              if (log && log.sourceFile !== activeFile) {
                onActiveFileChange(log.sourceFile);
              }
            }}
            className="h-full scrollbar-container"
            itemContent={(index, log) => {
              // Highlight specific logs in merged view
              // chrome_user_log, chrome_system_log and their PREVIOUS variants
              const sectionName = log.sourceFile.split("::").slice(1).join("::") || log.sourceFile;
              const isPriorityLog = [
                "chrome_user_log",
                "chrome_user_log.PREVIOUS",
                "chrome_system_log",
                "chrome_system_log.PREVIOUS"
              ].includes(sectionName);

              return (
                <div
                  data-log-index={index}
                  onClick={(event) => handleRowClick(event, index)}
                  onMouseDown={(event) => {
                    // Stop the browser extending its text selection, which would
                    // otherwise fight the row range on shift-click.
                    if (event.shiftKey) event.preventDefault();
                  }}
                  className={cn(isSelected(index) && "bg-primary/10")}
                >
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
                        <LogRow log={log} patterns={patterns}>
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
                                    <LogRow log={dup} patterns={patterns} isMain={false} />
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
                        <LogRow log={log} patterns={patterns} />
                      </div>
                    </div>
                  )}
                </div>
              );
            }}
          />
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-64">
        <ContextMenuItem
          disabled={!range}
          onSelect={() => range && copyLogs(logs.slice(range.from, range.to + 1), "lines")}
        >
          {selectedCount > 1 ? `Copy ${selectedCount.toLocaleString()} selected rows` : "Copy line"}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!range}
          onSelect={() =>
            range &&
            copyLogs(
              logs.slice(
                Math.max(0, range.from - CONTEXT_LINES),
                Math.min(logs.length, range.to + 1 + CONTEXT_LINES)
              ),
              "lines"
            )
          }
        >
          Copy with ±{CONTEXT_LINES} lines of context
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!anchorSection}
          onSelect={() =>
            copyLogs(
              logs.filter((log) => log.sourceFile === anchorSection),
              "lines from this section"
            )
          }
        >
          Copy this section
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => copyLogs(logs, "lines")}>
          Copy everything in view ({logs.length.toLocaleString()} rows)
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          disabled={!anchorLog}
          onSelect={() => anchorLog && toggleBookmark(anchorLog)}
        >
          {anchorLog && bookmarkKeys.has(bookmarkKey(anchorLog))
            ? "Remove bookmark"
            : "Bookmark line"}
        </ContextMenuItem>

        {/* B5: the same instant, seen from another subsystem. */}
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={jumpTargets.length === 0}>
            Jump to this time in
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-80 overflow-y-auto">
            {jumpTargets.map((target) => (
              <ContextMenuItem key={target.key} onSelect={() => jumpToSectionAtTime(target.key)}>
                <span className="truncate">{sectionNameOf(target.key)}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
};
