// Move reusable parts here to fix Fast Refresh issues
import { IUserLog } from "@renderer/lib/typings";
import { cn } from "@renderer/lib/utils";
import { HighlightedText } from "@renderer/components/highlighted-text";
import { getLevelColor } from "@renderer/lib/log-utils";

interface LogRowProps {
  log: IUserLog;
  isMain?: boolean;
  query?: string;
  isRegex?: boolean;
  children?: React.ReactNode;
}

export const LogRow = ({
  log,
  isMain = true,
  query = "",
  isRegex = false,
  children
}: LogRowProps) => (
  <div
    className={cn(
      "text-text-primary font-mono text-xs flex gap-2 py-1 border-b border-border/50 last:border-0 items-start min-h-7.5",
      !isMain && "pl-2 bg-muted/20"
    )}
  >
    {!isMain && <div className="pt-0.5">&gt;</div>}
    {log.level && (
      <span
        data-log-field="level"
        className={cn("shrink-0 w-12 font-bold text-center pt-0.5", getLevelColor(log.level))}
      >
        {log.level}
      </span>
    )}
    {log.process && (
      <span
        data-log-field="process"
        className="text-muted-foreground shrink-0 w-32 truncate text-right mr-2 pt-0.5"
        title={log.process}
      >
        {log.process}
      </span>
    )}
    {log.timestamp && (
      <span data-log-field="timestamp" className="text-muted-foreground shrink-0 min-w-45 pt-0.5">
        <HighlightedText text={log.timestamp} query={query} isRegex={isRegex} />
      </span>
    )}
    <span className="flex-1 text-text-secondary min-w-0">
      <div className="whitespace-pre-wrap break-all">
        {log.source && (
          <span data-log-field="source" className="text-muted-foreground mr-1 select-text">
            [<HighlightedText text={log.source} query={query} isRegex={isRegex} />]
          </span>
        )}
        <span data-log-field="message" className="text-text-primary font-medium select-text">
          <b>
            <HighlightedText text={log.message} query={query} isRegex={isRegex} />
          </b>
        </span>
        {children}
      </div>
    </span>
  </div>
);
