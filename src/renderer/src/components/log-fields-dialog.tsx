import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import { Table2, Search } from "lucide-react";
import { Button } from "@vibeus/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { logFilesAtom } from "@renderer/lib/atom";
import { extractSingleLineFields, LogField } from "@renderer/lib/log-parser";

interface FileFields {
  fileName: string;
  fields: LogField[];
}

// Rendered only once the dialog opens, so scanning the log files stays off the
// path that loads them.
function FieldsTable() {
  const logFiles = useAtomValue(logFilesAtom);
  const [query, setQuery] = useState("");

  const perFile = useMemo<FileFields[]>(
    () =>
      logFiles
        .filter((file) => !file.imageDataUrl)
        .map((file) => ({ fileName: file.name, fields: extractSingleLineFields(file.content) }))
        .filter((entry) => entry.fields.length > 0),
    [logFiles]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return perFile;
    return perFile
      .map((entry) => ({
        ...entry,
        fields: entry.fields.filter(
          (field) =>
            field.key.toLowerCase().includes(needle) || field.value.toLowerCase().includes(needle)
        )
      }))
      .filter((entry) => entry.fields.length > 0);
  }, [perFile, query]);

  const total = filtered.reduce((count, entry) => count + entry.fields.length, 0);

  return (
    <>
      <div className="relative flex items-center">
        <Search className="absolute left-2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter properties..."
          className="pl-8 h-8"
        />
      </div>

      <div className="overflow-auto max-h-[60vh] scrollbar-container">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No properties match “{query}”.
          </p>
        ) : (
          filtered.map((entry) => (
            <div key={entry.fileName} className="mb-4 last:mb-0">
              {filtered.length > 1 && (
                <div
                  className="text-xs font-semibold text-muted-foreground mb-1 truncate"
                  title={entry.fileName}
                >
                  {entry.fileName}
                </div>
              )}
              <table className="w-full text-xs font-mono border-collapse">
                <tbody>
                  {entry.fields.map((field, index) => (
                    <tr key={`${field.key}-${index}`} className="border-b border-border/40">
                      <td className="align-top py-1 pr-4 w-1/3 text-muted-foreground break-all select-text">
                        {field.key}
                      </td>
                      <td className="align-top py-1 break-all select-text whitespace-pre-wrap">
                        {field.value || <span className="opacity-40">(empty)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
    </>
  );
}

export function LogFieldsDialog() {
  const logFiles = useAtomValue(logFilesAtom);
  const hasTextFile = logFiles.some((file) => !file.imageDataUrl);

  if (!hasTextFile) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="text" className="h-6 text-xs px-2 gap-1" title="View device properties">
          <Table2 className="h-3.5 w-3.5" />
          Properties
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Device properties</DialogTitle>
          <DialogDescription>
            The single-line fields recorded alongside the log sections.
          </DialogDescription>
        </DialogHeader>

        <FieldsTable />
      </DialogContent>
    </Dialog>
  );
}
