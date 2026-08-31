import { useEffect, useState } from "react";
import { useAtom, useSetAtom } from "jotai";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@renderer/components/ui/command";
import {
  clearFiltersAtom,
  levelFilterAtom,
  LogLevelName,
  searchModeAtom
} from "@renderer/lib/atom";
import { classifySection, sectionNameOf } from "@renderer/lib/log-domains";

interface CommandPaletteProps {
  sectionKeys: string[];
  onGoToSection: (key: string) => void;
  onFocusSearch: () => void;
  onToggleMerge: () => void;
}

/**
 * A hundred-odd sections is too many to reach by scrolling a sidebar, so the
 * palette is the keyboard route to any of them, plus the handful of view
 * switches worth reaching without the mouse.
 */
export const CommandPalette = ({
  sectionKeys,
  onGoToSection,
  onFocusSearch,
  onToggleMerge
}: CommandPaletteProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [levels, setLevels] = useAtom(levelFilterAtom);
  const [searchMode, setSearchMode] = useAtom(searchModeAtom);
  const clearFilters = useSetAtom(clearFiltersAtom);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen((open) => !open);
        return;
      }
      if (meta && event.key.toLowerCase() === "f") {
        event.preventDefault();
        onFocusSearch();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onFocusSearch]);

  const run = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  const onlyLevel = (level: LogLevelName) => () =>
    setLevels(levels.size === 1 && levels.has(level) ? new Set() : new Set([level]));

  return (
    <CommandDialog open={isOpen} onOpenChange={setIsOpen}>
      <CommandInput placeholder="Jump to a section, or run a command..." />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>

        <CommandGroup heading="View">
          <CommandItem onSelect={() => run(onFocusSearch)}>Search the log</CommandItem>
          <CommandItem onSelect={() => run(onToggleMerge)}>Toggle merged timeline</CommandItem>
          <CommandItem onSelect={() => run(onlyLevel("ERROR"))}>Show only errors</CommandItem>
          <CommandItem onSelect={() => run(onlyLevel("WARN"))}>Show only warnings</CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => setSearchMode(searchMode === "filter" ? "highlight" : "filter"))
            }
          >
            {searchMode === "filter"
              ? "Step through matches instead of filtering"
              : "Filter the list to search matches"}
          </CommandItem>
          <CommandItem onSelect={() => run(() => clearFilters())}>Clear all filters</CommandItem>
        </CommandGroup>

        <CommandGroup heading="Sections">
          {sectionKeys.map((key) => {
            const name = sectionNameOf(key);
            return (
              <CommandItem
                key={key}
                value={`${name} ${classifySection(name)}`}
                onSelect={() => run(() => onGoToSection(key))}
              >
                <span className="truncate">{name}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {classifySection(name)}
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
