import { useMemo, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@renderer/components/ui/tabs";
import { cn } from "@renderer/lib/utils";
import { compareArchiveAtom, logFilesAtom, parsedLogsMapAtom } from "@renderer/lib/atom";
import { readFiles, readFilesByPath } from "@renderer/lib/file-loader";
import { processFilesAsync } from "@renderer/lib/log-processor";
import { recentFiles } from "@renderer/lib/recent-files";
import {
  CountDiff,
  diffArchives,
  Evidence,
  SectionCounts,
  summariseArchive
} from "@renderer/lib/log-diff";
import { LogFileContext } from "@renderer/lib/typings";

interface CompareViewProps {
  onJumpToEvidence: (evidence: Evidence) => void;
}

const MAX_TEMPLATE_ROWS = 200;

const KIND_STYLE: Record<string, string> = {
  critical: "text-red-500",
  ERROR: "text-red-500",
  warning: "text-amber-500",
  WARN: "text-amber-500"
};

const Delta = ({ a, b }: { a: number; b: number }) => {
  if (a === 0 || b === 0) {
    return (
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap",
          b === 0
            ? "bg-red-500/15 text-red-600 dark:text-red-400"
            : "bg-sky-500/15 text-sky-700 dark:text-sky-400"
        )}
      >
        {b === 0 ? "only this" : "only other"}
      </span>
    );
  }
  // From the open log's side: it is usually the one being investigated.
  const diff = a - b;
  return (
    <span className={cn("tabular-nums", diff > 0 ? "text-red-500" : "text-muted-foreground")}>
      {diff > 0 ? `+${diff.toLocaleString()}` : diff.toLocaleString()}
    </span>
  );
};

const COUNT_COLUMNS = "grid grid-cols-[3.5rem_1fr_4.5rem_4.5rem_5.5rem] gap-x-2";

const CountRows = ({
  rows,
  onJump
}: {
  rows: CountDiff[];
  onJump: (evidence: Evidence) => void;
}) => (
  <>
    <div
      className={cn(
        COUNT_COLUMNS,
        "text-[10px] uppercase tracking-wide text-muted-foreground border-b pb-1"
      )}
    >
      <span />
      <span />
      <span className="text-right">This</span>
      <span className="text-right">Other</span>
      <span className="text-right">Difference</span>
    </div>
    {rows.map((row) => (
      <button
        key={row.key}
        type="button"
        disabled={!row.sample}
        onClick={() => row.sample && onJump(row.sample)}
        title={row.sample ? row.label : "Only the other log has these lines"}
        className={cn(
          COUNT_COLUMNS,
          "items-baseline text-left text-xs py-1 border-b border-border/40 min-w-0",
          row.sample ? "hover:bg-muted/60 transition-colors" : "cursor-default"
        )}
      >
        <span className={cn("text-[10px] font-bold", KIND_STYLE[row.kind])}>{row.kind}</span>
        <span className="font-mono text-[11px] truncate min-w-0">{row.label}</span>
        <span className="text-right tabular-nums">{row.a.toLocaleString()}</span>
        <span className="text-right tabular-nums">{row.b.toLocaleString()}</span>
        <span className="text-right">
          <Delta a={row.a} b={row.b} />
        </span>
      </button>
    ))}
  </>
);

const sectionCell = (counts?: SectionCounts) =>
  counts ? (
    <>
      {counts.lines.toLocaleString()}
      {counts.errors > 0 && <span className="text-red-500 ml-1">{counts.errors}E</span>}
    </>
  ) : (
    <span className="text-muted-foreground">—</span>
  );

const fileLabel = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * "Why does this one fail and that one not" -- answered by lining up what the
 * two archives can be compared on. Not line by line: timestamps and pids differ
 * on every line, so a textual diff is all noise.
 */
export function CompareView({ onJumpToEvidence }: CompareViewProps) {
  const logFiles = useAtomValue(logFilesAtom);
  const parsedLogs = useAtomValue(parsedLogsMapAtom);
  const [other, setOther] = useAtom(compareArchiveAtom);
  const [status, setStatus] = useState<string | null>(null);

  const here = useMemo(
    () => (other ? summariseArchive(logFiles, parsedLogs) : null),
    [other, logFiles, parsedLogs]
  );
  const diff = useMemo(
    () => (here && other ? diffArchives(here, other.summary) : null),
    [here, other]
  );

  const load = async (name: string, read: () => Promise<LogFileContext[]>) => {
    setStatus("Reading files...");
    try {
      const files = await read();
      const { parsedLogs: otherLogs, updatedFiles } = await processFilesAsync(files, setStatus);
      setStatus("Comparing...");
      setOther({ name, summary: summariseArchive(updatedFiles, otherLogs) });
    } catch (err) {
      toast.error(`Could not open: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setStatus(null);
    }
  };

  const chooseFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,.log,.zip";
    input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) return;
      const name = files.length === 1 ? files[0].name : `${files.length} files`;
      load(name, () => readFiles(files));
    };
    input.click();
  };

  if (status) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {status}
      </div>
    );
  }

  if (!other || !diff) {
    const recent = recentFiles();
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-md mx-auto flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold">Compare with another log</h3>
            <p className="text-xs text-muted-foreground">
              Before and after a repro, or a good device and a bad one. Sections, fields, error
              shapes and diagnostics are lined up side by side.
            </p>
          </div>
          {recent.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Recent
              </div>
              {recent.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  title={entry.path}
                  onClick={() => load(entry.name, () => readFilesByPath([entry.path]))}
                  className="flex items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted transition-colors min-w-0"
                >
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={chooseFile}
            className="self-start h-7 px-3 rounded-md border text-xs font-medium hover:bg-muted transition-colors"
          >
            Choose file…
          </button>
        </div>
      </div>
    );
  }

  const changedFindings = diff.findings.filter((row) => row.a !== row.b);
  const oneSidedSections = diff.sections.filter((row) => !row.a || !row.b).length;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 py-1.5 border-b flex items-center gap-2 text-xs shrink-0 min-w-0">
        <span className="text-muted-foreground shrink-0">Other:</span>
        <span className="font-medium truncate min-w-0" title={other.name}>
          {fileLabel(other.name)}
        </span>
        <button
          type="button"
          onClick={() => setOther(null)}
          className="ml-auto h-6 px-2 rounded-md text-muted-foreground hover:bg-muted inline-flex items-center gap-1 shrink-0"
        >
          <X className="size-3" />
          Change
        </button>
      </div>

      <Tabs defaultValue="diagnostics" className="flex-1 min-h-0 min-w-0 items-start p-3">
        <TabsList className="w-32">
          <TabsTrigger value="diagnostics">
            Diagnostics
            <span className="ml-1 tabular-nums opacity-60">{changedFindings.length}</span>
          </TabsTrigger>
          <TabsTrigger value="errors">
            Error shapes
            <span className="ml-1 tabular-nums opacity-60">{diff.templates.length}</span>
          </TabsTrigger>
          <TabsTrigger value="sections">
            Sections
            <span className="ml-1 tabular-nums opacity-60">{oneSidedSections}</span>
          </TabsTrigger>
          <TabsTrigger value="fields">
            Fields
            <span className="ml-1 tabular-nums opacity-60">{diff.fields.length}</span>
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 min-w-0 h-full overflow-x-hidden overflow-y-auto scrollbar-container pr-1">
          <TabsContent value="diagnostics" className="flex flex-col m-0">
            {diff.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Neither log matches any of the known failure patterns.
              </p>
            ) : (
              <CountRows rows={diff.findings} onJump={onJumpToEvidence} />
            )}
          </TabsContent>

          <TabsContent value="errors" className="flex flex-col m-0">
            <p className="text-xs text-muted-foreground mb-2">
              Errors and warnings grouped by shape, with the ones only one side has first.
            </p>
            {diff.templates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Both logs have the same errors and warnings, the same number of times.
              </p>
            ) : (
              <CountRows
                rows={diff.templates.slice(0, MAX_TEMPLATE_ROWS)}
                onJump={onJumpToEvidence}
              />
            )}
            {diff.templates.length > MAX_TEMPLATE_ROWS && (
              <p className="text-xs text-muted-foreground py-2 text-center">
                Showing the first {MAX_TEMPLATE_ROWS} of {diff.templates.length.toLocaleString()}.
              </p>
            )}
          </TabsContent>

          <TabsContent value="sections" className="flex flex-col m-0">
            <div className="grid grid-cols-[1fr_7rem_7rem] gap-x-2 text-[10px] uppercase tracking-wide text-muted-foreground border-b pb-1">
              <span>Section</span>
              <span className="text-right">This</span>
              <span className="text-right">Other</span>
            </div>
            {diff.sections.map((row) => (
              <div
                key={row.name}
                className="grid grid-cols-[1fr_7rem_7rem] gap-x-2 items-baseline text-xs tabular-nums py-0.5 border-b border-border/40 min-w-0"
              >
                <span
                  className={cn("font-mono truncate min-w-0", row.a && row.b && "opacity-70")}
                  title={row.name}
                >
                  {row.name}
                </span>
                <span className="text-right">{sectionCell(row.a)}</span>
                <span className="text-right">{sectionCell(row.b)}</span>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="fields" className="flex flex-col m-0">
            {diff.fields.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Every key=value field is the same in both logs.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-[14rem_1fr_1fr] gap-x-3 text-[10px] uppercase tracking-wide text-muted-foreground border-b pb-1">
                  <span>Field</span>
                  <span>This</span>
                  <span>Other</span>
                </div>
                {diff.fields.map((row) => (
                  <div
                    key={row.key}
                    className="grid grid-cols-[14rem_1fr_1fr] gap-x-3 items-baseline text-xs py-0.5 border-b border-border/40 min-w-0 select-text"
                  >
                    <span className="font-mono truncate min-w-0" title={row.key}>
                      {row.key}
                    </span>
                    <span className="font-mono truncate min-w-0" title={row.a}>
                      {row.a ?? <span className="text-muted-foreground">—</span>}
                    </span>
                    <span className="font-mono truncate min-w-0" title={row.b}>
                      {row.b ?? <span className="text-muted-foreground">—</span>}
                    </span>
                  </div>
                ))}
              </>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
