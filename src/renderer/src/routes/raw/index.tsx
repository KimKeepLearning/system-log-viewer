import { logContentAtom } from "@renderer/lib/atom";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { Button } from "@vibeus/ui";
import { HighlightedText } from "@renderer/components/highlighted-text";
import { Input } from "@renderer/components/ui/input";
import { Search, ArrowUp, ArrowDown, Regex } from "lucide-react";
import { useState, useMemo, useEffect, useRef } from "react";
import { cn } from "@renderer/lib/utils";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";

export const Route = createFileRoute("/raw/")({
  component: RouteComponent
});

function RouteComponent() {
  const logContent = useAtomValue(logContentAtom);
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [isValidRegex, setIsValidRegex] = useState(true);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const lines = useMemo(() => logContent.split("\n"), [logContent]);

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

  // Determine matches
  const matchIndices = useMemo(() => {
    if (!searchQuery) return [];

    const indices: number[] = [];
    try {
      const effectiveQuery = isRegex
        ? searchQuery
        : searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(effectiveQuery, "i");

      lines.forEach((line, index) => {
        if (re.test(line)) {
          indices.push(index);
        }
      });
    } catch {
      // invalid regex
    }
    return indices;
  }, [lines, searchQuery, isRegex]);

  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [matchIndices.length]);

  const handlePrevMatch = () => {
    if (matchIndices.length === 0) return;
    setCurrentMatchIndex((prev) => {
      const next = prev - 1;
      if (next < 0) return matchIndices.length - 1;
      return next;
    });
    scrollToMatch(
      (currentMatchIndex - 1 + matchIndices.length) % matchIndices.length,
      matchIndices
    );
  };

  const handleNextMatch = () => {
    if (matchIndices.length === 0) return;
    setCurrentMatchIndex((prev) => {
      const next = prev + 1;
      if (next >= matchIndices.length) return 0;
      return next;
    });
    scrollToMatch((currentMatchIndex + 1) % matchIndices.length, matchIndices);
  };

  const scrollToMatch = (index: number, indices: number[]) => {
    const lineIndex = indices[index];
    virtuosoRef.current?.scrollToIndex({
      index: lineIndex,
      align: "center",
      behavior: "smooth"
    });
  };

  return (
    <div className="flex flex-col h-screen bg-fill-background-surface-l1">
      <div className="flex p-spacing-sm items-center gap-4 bg-fill-background-surface-base border-b border-stroke-divider">
        <Button variant="secondary" onClick={() => router.history.back()}>
          Back
        </Button>

        <div className="relative flex items-center w-100">
          <Search className="absolute left-2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isRegex ? "Regex pattern (e.g. ^Error.*)" : "Search in raw log..."}
            className={cn(
              "pl-8 pr-40 h-8 bg-fill-background-inverse/10 border-none focus-visible:ring-1 min-w-0 flex-1",
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
            {matchIndices.length > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums min-w-[3ch] text-center">
                {currentMatchIndex + 1}/{matchIndices.length}
              </span>
            )}
            <div className="flex gap-0.5">
              <Button
                variant="text"
                className="h-6 w-6 p-0 min-w-0 justify-center z-10 hover:bg-fill-layout-surface-base"
                onClick={handlePrevMatch}
                disabled={matchIndices.length === 0}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                variant="text"
                className="h-6 w-6 p-0 min-w-0 justify-center z-10 hover:bg-fill-layout-surface-base"
                onClick={handleNextMatch}
                disabled={matchIndices.length === 0}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <Virtuoso
          ref={virtuosoRef}
          data={lines}
          itemContent={(index, line) => {
            const isCurrentMatchLine = matchIndices[currentMatchIndex] === index;

            return (
              <div
                style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}
                className={cn(isCurrentMatchLine && "bg-yellow-500/20")}
              >
                <HighlightedText text={line} query={searchQuery} isRegex={isRegex} />
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
