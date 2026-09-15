import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { cn } from "@renderer/lib/utils";
import { Pause, Play, Square } from "lucide-react";

interface SSHLiveTailProps {
  open: boolean;
  target: SSHTarget | null;
  command: string;
  label: string;
  onOpenChange: (open: boolean) => void;
  /** Hand the captured text to the viewer as a log file. */
  onOpenInViewer: (text: string, name: string) => void;
}

// Enough to see the shape of a burst without letting a chatty device grow the
// buffer without bound; the full capture is what gets opened in the viewer.
const MAX_LINES = 5000;

const STATE_LABELS: Record<SSHFollowState, string> = {
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  streaming: "Live",
  waiting: "Waiting to retry",
  error: "Error",
  "gave-up": "Disconnected",
  stopped: "Stopped"
};

export function SSHLiveTail({
  open,
  target,
  command,
  label,
  onOpenChange,
  onOpenInViewer
}: SSHLiveTailProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<SSHFollowStatus | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const stopRef = useRef<(() => void) | null>(null);
  const partialRef = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  useEffect(() => {
    if (!open || !target) return;

    setLines([]);
    setStatus(null);
    partialRef.current = "";

    const id = `follow-${Date.now()}`;
    stopRef.current = window.api.ssh.follow(
      id,
      target,
      command,
      (chunk) => {
        // A chunk can end mid-line, so the tail is carried into the next one.
        const text = partialRef.current + chunk.replace(/\r\n?/g, "\n");
        const parts = text.split("\n");
        partialRef.current = parts.pop() ?? "";
        if (parts.length === 0) return;
        setLines((prev) => {
          const next = prev.concat(parts);
          return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
        });
      },
      setStatus
    );

    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [open, target, command]);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines, autoScroll]);

  const state = status?.state ?? "connecting";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) stop();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="truncate">{label}</span>
            <span
              className={cn(
                "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded",
                state === "streaming"
                  ? "bg-green-500/15 text-green-600"
                  : state === "error" || state === "gave-up"
                    ? "bg-red-500/15 text-red-600"
                    : "bg-muted text-muted-foreground"
              )}
            >
              {STATE_LABELS[state]}
              {status?.attempt ? ` #${status.attempt}` : ""}
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {lines.length.toLocaleString()} lines
            </span>
          </DialogTitle>
        </DialogHeader>

        {status?.message && <p className="text-xs text-red-600">{status.message}</p>}

        <div className="h-[420px] overflow-auto rounded border bg-muted/20 p-2 font-mono text-[11px] leading-relaxed">
          {lines.length === 0 ? (
            <p className="text-muted-foreground">Waiting for output…</p>
          ) : (
            lines.map((line, index) => (
              <div key={index} className="whitespace-pre-wrap break-all">
                {line}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAutoScroll(!autoScroll)}>
            {autoScroll ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {autoScroll ? "Pause scroll" : "Resume scroll"}
          </Button>
          <Button variant="outline" size="sm" onClick={stop} disabled={state === "stopped"}>
            <Square className="size-3.5" />
            Stop
          </Button>
          <Button
            className="ml-auto"
            size="sm"
            disabled={lines.length === 0}
            onClick={() => {
              stop();
              onOpenInViewer(lines.join("\n"), label);
            }}
          >
            Open in viewer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
