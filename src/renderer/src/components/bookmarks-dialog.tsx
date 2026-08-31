import { useAtom, useSetAtom } from "jotai";
import { Bookmark as BookmarkIcon, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@vibeus/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@renderer/components/ui/dialog";
import { Textarea } from "@renderer/components/ui/textarea";
import { Badge } from "@renderer/components/ui/badge";
import { cn } from "@renderer/lib/utils";
import { getLevelColor } from "@renderer/lib/log-utils";
import { sectionNameOf } from "@renderer/lib/log-domains";
import {
  bookmarksAtom,
  bookmarksToMarkdown,
  setBookmarkNoteAtom,
  type Bookmark
} from "@renderer/lib/bookmarks";

const clock = (mark: Bookmark): string =>
  mark.ts === null ? mark.timestamp || "—" : new Date(mark.ts / 1000).toISOString().slice(11, 23);

export function BookmarksDialog() {
  const [bookmarks, setBookmarks] = useAtom(bookmarksAtom);
  const setNote = useSetAtom(setBookmarkNoteAtom);

  if (bookmarks.length === 0) return null;

  const copyMarkdown = () => {
    navigator.clipboard
      .writeText(bookmarksToMarkdown(bookmarks))
      .then(() => toast.success(`Copied ${bookmarks.length} bookmarks as Markdown`))
      .catch((err) => toast.error(`Could not copy: ${err instanceof Error ? err.message : err}`));
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="text" className="h-6 text-xs px-2 gap-1" title="Bookmarked lines">
          <BookmarkIcon className="h-3.5 w-3.5" />
          Bookmarks
          <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums">
            {bookmarks.length}
          </Badge>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bookmarks</DialogTitle>
          <DialogDescription>
            In time order. Notes travel with the line into the exported timeline.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 overflow-y-auto max-h-[55vh] scrollbar-container pr-1">
          {bookmarks.map((mark) => (
            <div key={mark.id} className="border rounded-md p-2 flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2 text-[11px] font-mono">
                <span className="text-muted-foreground tabular-nums shrink-0">{clock(mark)}</span>
                {mark.level && (
                  <span className={cn("font-bold shrink-0", getLevelColor(mark.level))}>
                    {mark.level}
                  </span>
                )}
                <span className="text-muted-foreground truncate shrink-0 max-w-40">
                  {sectionNameOf(mark.sourceFile)}
                </span>
                <button
                  type="button"
                  className="ml-auto text-muted-foreground hover:text-destructive shrink-0"
                  title="Remove bookmark"
                  onClick={() => setBookmarks(bookmarks.filter((other) => other.id !== mark.id))}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              <p className="font-mono text-xs break-all select-text">{mark.message}</p>

              <Textarea
                value={mark.note}
                onChange={(event) => setNote(mark.id, event.target.value)}
                placeholder="Why does this line matter?"
                className="text-xs min-h-0 h-14 resize-none"
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" className="h-7 text-xs gap-1.5" onClick={copyMarkdown}>
            <Copy className="size-3.5" />
            Copy as Markdown
          </Button>
          <Button
            variant="text"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => setBookmarks([])}
          >
            Clear all
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
