import { useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { ArrowDown, ArrowUp, HelpCircle, Search, X } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { Input } from "@renderer/components/ui/input";
import { Button } from "@renderer/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@renderer/components/ui/popover";
import { currentMatchIndexAtom, searchModeAtom, searchQueryAtom } from "@renderer/lib/atom";
import { ParsedQuery, QUERY_FIELDS } from "@renderer/lib/log-query";

interface Suggestion {
  /** What replaces the token being typed. */
  insert: string;
  label: string;
  hint?: string;
}

interface SearchBarProps {
  parsed: ParsedQuery;
  matchCount: number;
  processes: { name: string; count: number }[];
  sections: string[];
  levels: string[];
  tags: string[];
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

const SYNTAX_HELP: [string, string][] = [
  ["mojo pipe", "lines containing both words"],
  ['"not found"', "that exact phrase"],
  ["-heartbeat", "lines without it"],
  ["level:error", "only errors — repeat the field to allow several"],
  ["process:chrome", "matches chrome[1016:1016] too"],
  ["section:dmesg", "one section"],
  ['tag:"AI Subscription"', "a subsystem label the code stamped on the line"],
  ["/pipe.*closed/", "a regular expression, when you really want one"]
];

// The token under the cursor is what a suggestion replaces, so completing
// `process:ch` leaves the rest of the query alone.
const activeToken = (value: string): { start: number; text: string } => {
  const start = value.lastIndexOf(" ") + 1;
  return { start, text: value.slice(start) };
};

export const SearchBar = ({
  parsed,
  matchCount,
  processes,
  sections,
  levels,
  tags,
  inputRef: externalRef
}: SearchBarProps) => {
  const [query, setQuery] = useAtom(searchQueryAtom);
  const [currentMatch, setCurrentMatch] = useAtom(currentMatchIndexAtom);
  const searchMode = useAtomValue(searchModeAtom);
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? localRef;
  const [isFocused, setIsFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const suggestions = useMemo<Suggestion[]>(() => {
    const { text } = activeToken(query);
    const bare = text.startsWith("-") || text.startsWith("!") ? text.slice(1) : text;
    const prefix = text.slice(0, text.length - bare.length);
    const colon = bare.indexOf(":");

    if (colon > 0) {
      const field = bare.slice(0, colon).toLowerCase();
      const typed = bare.slice(colon + 1).toLowerCase();
      const values =
        field === "process"
          ? processes
              .filter((p) => p.name.toLowerCase().includes(typed))
              .slice(0, 8)
              .map((p) => ({
                insert: `${prefix}process:${p.name}`,
                label: p.name,
                hint: p.count.toLocaleString()
              }))
          : field === "section"
            ? sections
                .filter((name) => name.toLowerCase().includes(typed))
                .slice(0, 8)
                .map((name) => ({ insert: `${prefix}section:${name}`, label: name }))
            : field === "level"
              ? levels
                  .filter((name) => name.toLowerCase().includes(typed))
                  .map((name) => ({ insert: `${prefix}level:${name}`, label: name }))
              : field === "tag"
                ? tags
                    .filter((name) => name.toLowerCase().includes(typed))
                    .slice(0, 8)
                    // Tags contain spaces, so a completion has to quote itself.
                    .map((name) => ({ insert: `${prefix}tag:"${name}"`, label: name }))
                : [];
      return values;
    }

    if (!bare) return [];
    return QUERY_FIELDS.filter((field) => field.startsWith(bare.toLowerCase())).map((field) => ({
      insert: `${prefix}${field}:`,
      label: `${field}:`,
      hint: "field"
    }));
  }, [query, processes, sections, levels, tags]);

  const isOpen = isFocused && suggestions.length > 0;

  const apply = (suggestion: Suggestion) => {
    const { start } = activeToken(query);
    const next = query.slice(0, start) + suggestion.insert;
    setQuery(suggestion.insert.endsWith(":") ? next : `${next} `);
    inputRef.current?.focus();
    setHighlighted(0);
  };

  const step = (delta: number) => {
    if (matchCount === 0) return;
    setCurrentMatch((previous) => (previous + delta + matchCount) % matchCount);
  };

  return (
    // flex-1 on the root, not just on the input: without it the bar is sized to
    // its content, and the input's own flex-1 divides up that width instead of
    // the row's.
    <div className="flex flex-1 items-center gap-1.5 min-w-0">
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlighted(0);
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => window.setTimeout(() => setIsFocused(false), 120)}
          onKeyDown={(event) => {
            if (isOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault();
              const delta = event.key === "ArrowDown" ? 1 : -1;
              setHighlighted((h) => (h + delta + suggestions.length) % suggestions.length);
              return;
            }
            if (event.key === "Tab" && isOpen) {
              event.preventDefault();
              apply(suggestions[highlighted]);
              return;
            }
            if (event.key === "Enter") {
              if (isOpen) {
                event.preventDefault();
                apply(suggestions[highlighted]);
              } else {
                step(event.shiftKey ? -1 : 1);
              }
              return;
            }
            if (event.key === "Escape") {
              if (isOpen) setIsFocused(false);
              else setQuery("");
            }
          }}
          placeholder="Search — try  level:error mojo  or  -heartbeat"
          className={cn(
            "pl-7 pr-7 h-7 text-xs font-mono",
            parsed.error && "ring-1 ring-red-500 focus-visible:ring-red-500"
          )}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}

        {isOpen && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-md border bg-popover shadow-md overflow-hidden">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.insert}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => apply(suggestion)}
                onMouseEnter={() => setHighlighted(index)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1 text-xs font-mono text-left",
                  index === highlighted ? "bg-muted" : "hover:bg-muted/60"
                )}
              >
                <span className="truncate flex-1">{suggestion.label}</span>
                {suggestion.hint && (
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {suggestion.hint}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {parsed.error ? (
        <span className="text-[10px] text-red-500 truncate max-w-48" title={parsed.error}>
          {parsed.error}
        </span>
      ) : (
        query && (
          <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
            {matchCount === 0
              ? "no matches"
              : searchMode === "filter"
                ? `${matchCount.toLocaleString()} shown`
                : `${((currentMatch % matchCount) + 1).toLocaleString()} / ${matchCount.toLocaleString()}`}
          </span>
        )
      )}

      <div className="flex">
        <Button
          variant="ghost"
          size="sm"
          className="size-6 p-0"
          disabled={matchCount === 0 || searchMode === "filter"}
          onClick={() => step(-1)}
          title="Previous match (Shift+Enter)"
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="size-6 p-0"
          disabled={matchCount === 0 || searchMode === "filter"}
          onClick={() => step(1)}
          title="Next match (Enter)"
        >
          <ArrowDown className="size-3.5" />
        </Button>
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="size-6 p-0" title="Search syntax">
            <HelpCircle className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 text-xs">
          <p className="font-medium mb-2">Search syntax</p>
          <dl className="flex flex-col gap-1.5">
            {SYNTAX_HELP.map(([syntax, meaning]) => (
              <div key={syntax} className="flex gap-2 items-baseline">
                <dt className="font-mono bg-muted rounded px-1 py-0.5 shrink-0">{syntax}</dt>
                <dd className="text-muted-foreground">{meaning}</dd>
              </div>
            ))}
          </dl>
        </PopoverContent>
      </Popover>
    </div>
  );
};
