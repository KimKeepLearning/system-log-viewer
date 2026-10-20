import { Fragment, useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Check, Copy, FolderGit2, Loader2, Settings, Sparkles, Square, X } from "lucide-react";
import { Textarea } from "@renderer/components/ui/textarea";
import { Input } from "@renderer/components/ui/input";
import { cn } from "@renderer/lib/utils";
import {
  aiMarksAtom,
  aiPanelOpenAtom,
  logFilesAtom,
  mcpActivityAtom,
  parsedLogsMapAtom
} from "@renderer/lib/atom";
import { AI_MARK_STYLE, createLogTools } from "@renderer/lib/ai-tools";
import { createRedactor } from "@renderer/lib/log-redact";

interface AiPanelProps {
  hidden: boolean;
  onJumpToLine: (key: string, index: number) => void;
  /** The dashboard's tools over the open archive, for resolving refs. */
  logTools: ReturnType<typeof createLogTools>;
}

interface Run {
  id: string | null;
  running: boolean;
  steps: string[];
  answer: string;
  error?: string;
}

const quote = (value: unknown) => JSON.stringify(String(value ?? ""));

// What the activity list says for each tool call, so the user can follow the
// investigation and see exactly what was looked at.
const describeStep = (name: string, input: unknown): string => {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "search_logs":
      return `Searched logs for ${quote(args.query)}${args.section ? ` in ${args.section}` : ""}${args.level ? ` (${args.level})` : ""}`;
    case "read_logs":
      return `Read around ${args.ref}`;
    case "mark_line":
      return `Marked ${args.ref} as ${args.kind}`;
    case "read_source":
      return `Read source ${args.path}${args.line ? `:${args.line}` : ""}`;
    case "search_source":
      return `Searched source for ${quote(args.pattern)} in ${args.path}`;
    case "get_overview":
      return "Read the archive overview";
    case "clear_marks":
      return "Cleared the marks";
    default:
      return name;
  }
};

const REF_IN_TEXT = /\bs\d+:\d+\b/g;

const connectCommand = (status: McpStatus) =>
  `claude mcp add --scope user --transport http system-log-viewer ${status.url} --header "Authorization: Bearer ${status.token}"`;

export function AiPanel({ hidden, onJumpToLine, logTools }: AiPanelProps) {
  const logFiles = useAtomValue(logFilesAtom);
  const parsedLogs = useAtomValue(parsedLogsMapAtom);
  const [marks, setMarks] = useAtom(aiMarksAtom);
  const setOpen = useSetAtom(aiPanelOpenAtom);
  const activity = useAtomValue(mcpActivityAtom);
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);
  const [copied, setCopied] = useState(false);

  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [settingsError, setSettingsError] = useState<string>();
  const [problem, setProblem] = useState("");
  const [run, setRun] = useState<Run | null>(null);

  const toolsRef = useRef<ReturnType<typeof createLogTools> | null>(null);
  const runIdRef = useRef<string | null>(null);

  useEffect(() => {
    window.api.ai.getSettings().then(setSettings);
    window.api.mcp.status().then(setMcpStatus);
  }, []);

  const copyCommand = () => {
    if (!mcpStatus) return;
    void navigator.clipboard.writeText(connectCommand(mcpStatus)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  useEffect(() => {
    const stop = window.api.ai.listen(
      (event) => {
        if (event.runId !== runIdRef.current) return;
        setRun((current) => {
          if (!current) return current;
          switch (event.type) {
            case "text":
              return { ...current, answer: current.answer + event.text };
            case "tool":
              return {
                ...current,
                steps: [...current.steps, describeStep(event.name, event.input)]
              };
            case "done":
              return { ...current, running: false };
            case "error":
              return { ...current, running: false, error: event.message };
          }
        });
      },
      (call) => {
        if (call.runId !== runIdRef.current || !toolsRef.current) return "No active investigation.";
        return toolsRef.current.call(call.name, call.input);
      }
    );
    return () => {
      stop();
      if (runIdRef.current) void window.api.ai.cancel(runIdRef.current);
    };
  }, []);

  const saveKey = async () => {
    setSettingsError(undefined);
    try {
      setSettings(await window.api.ai.setKey(keyDraft.trim() || null));
      setKeyDraft("");
      setShowSettings(false);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : String(error));
    }
  };

  const start = async () => {
    if (!problem.trim()) return;
    setMarks([]);
    const tools = createLogTools(logFiles, parsedLogs, createRedactor(), (mark) =>
      setMarks((current) => [...current.filter((entry) => entry.ref !== mark.ref), mark])
    );
    toolsRef.current = tools;
    setRun({ id: null, running: true, steps: [], answer: "" });
    try {
      const id = await window.api.ai.start({ problem: problem.trim(), context: tools.context() });
      runIdRef.current = id;
      setRun((current) => (current ? { ...current, id } : current));
    } catch (error) {
      setRun({
        id: null,
        running: false,
        steps: [],
        answer: "",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const stop = () => {
    if (runIdRef.current) void window.api.ai.cancel(runIdRef.current);
  };

  const jumpToRef = (ref: string) => {
    const target = logTools.resolve(ref);
    if (target) onJumpToLine(target.key, target.index);
  };

  const renderAnswer = (text: string) => {
    const parts: React.ReactNode[] = [];
    let last = 0;
    for (const match of text.matchAll(REF_IN_TEXT)) {
      parts.push(text.slice(last, match.index));
      parts.push(
        <button
          key={match.index}
          type="button"
          onClick={() => jumpToRef(match[0])}
          className="font-mono text-primary hover:underline"
        >
          {match[0]}
        </button>
      );
      last = match.index + match[0].length;
    }
    parts.push(text.slice(last));
    return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>);
  };

  const needsKey = settings !== null && !settings.hasKey;

  return (
    <div
      className={cn(
        "w-[420px] shrink-0 border-l bg-background flex flex-col min-h-0",
        hidden && "hidden"
      )}
    >
      <div className="px-3 py-1.5 border-b flex items-center gap-2 shrink-0">
        <Sparkles className="size-3.5 text-primary" />
        <span className="text-sm font-semibold">Ask Claude</span>
        <button
          type="button"
          title="Settings"
          onClick={() => setShowSettings((value) => !value)}
          className="ml-auto size-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <Settings className="size-3.5" />
        </button>
        <button
          type="button"
          title="Close"
          onClick={() => setOpen(false)}
          className="size-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-container p-3 flex flex-col gap-3">
        {showSettings && settings && (
          <div className="rounded-md border p-2.5 flex flex-col gap-2 text-xs">
            <div className="font-medium">Anthropic API key</div>
            <p className="text-muted-foreground">
              {settings.hasKey
                ? "A key is saved. Paste a new one to replace it."
                : "Paste your own key. It is stored encrypted on this machine and only used for investigations you start."}
            </p>
            <div className="flex gap-1.5">
              <Input
                type="password"
                value={keyDraft}
                onChange={(event) => setKeyDraft(event.target.value)}
                placeholder="sk-ant-…"
                className="h-7 text-xs"
              />
              <button
                type="button"
                onClick={saveKey}
                disabled={!keyDraft.trim()}
                className="h-7 px-3 rounded-md border text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                Save
              </button>
            </div>
            {settings.hasKey && (
              <button
                type="button"
                onClick={async () => setSettings(await window.api.ai.setKey(null))}
                className="self-start text-muted-foreground hover:text-foreground"
              >
                Remove saved key
              </button>
            )}
            {settingsError && <p className="text-red-500">{settingsError}</p>}

            <div className="font-medium mt-1">Source checkout</div>
            <p className="text-muted-foreground">
              Optional. With it, Claude reads the code that wrote each log line, from{" "}
              <code>git grep</code> and the file at the line&rsquo;s source location.
            </p>
            <div className="flex items-center gap-1.5 min-w-0">
              <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono min-w-0" title={settings.sourceRoot ?? undefined}>
                {settings.sourceRoot ?? "Not set"}
              </span>
              <button
                type="button"
                onClick={async () => setSettings(await window.api.ai.pickSourceRoot())}
                className="ml-auto h-6 px-2 rounded-md border hover:bg-muted shrink-0"
              >
                Choose…
              </button>
              {settings.sourceRoot && (
                <button
                  type="button"
                  onClick={async () => setSettings(await window.api.ai.clearSourceRoot())}
                  className="h-6 px-2 rounded-md text-muted-foreground hover:bg-muted shrink-0"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        <div className="rounded-md border p-2.5 flex flex-col gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="font-medium">Use with Claude Code</span>
            {mcpStatus && (
              <span
                className={cn(
                  "ml-auto inline-flex items-center gap-1 text-[10px]",
                  mcpStatus.listening ? "text-emerald-600" : "text-red-500"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    mcpStatus.listening ? "bg-emerald-500" : "bg-red-500"
                  )}
                />
                {mcpStatus.listening ? "Ready" : "Not running"}
              </span>
            )}
          </div>
          <p className="text-muted-foreground">
            Works with your Claude Team seat, no API key. Run this once in a terminal; the terminal
            and the VS Code extension both pick it up.
          </p>
          {mcpStatus?.error && <p className="text-red-500">{mcpStatus.error}</p>}
          {mcpStatus && (
            <div className="relative">
              <pre className="font-mono text-[10px] bg-muted/50 rounded p-2 pr-8 whitespace-pre-wrap break-all select-all">
                {connectCommand(mcpStatus)}
              </pre>
              <button
                type="button"
                title="Copy"
                onClick={copyCommand}
                className="absolute top-1 right-1 size-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </button>
            </div>
          )}
          <p className="text-muted-foreground">
            Then ask Claude Code, for example:{" "}
            <span className="text-foreground">
              用 system-log-viewer 查一下这个反馈：下午连着 Wi-Fi 突然断了
            </span>
            . Lines it marks light up here and in the log.
          </p>
          {activity.length > 0 && (
            <details open className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer select-none">
                Claude Code activity ({activity.length})
              </summary>
              <ol className="mt-1 flex flex-col gap-0.5 pl-4 list-decimal">
                {activity.map((entry) => (
                  <li key={entry.at + entry.name} className="break-words">
                    {renderAnswer(describeStep(entry.name, entry.input))}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>

        <details className="flex flex-col gap-1.5 group">
          <summary className="text-xs font-medium cursor-pointer select-none">
            Or use an Anthropic API key
          </summary>
          <div className="flex flex-col gap-1.5 mt-1.5">
            {needsKey && (
              <p className="text-xs text-muted-foreground">
                Add a key under settings (the gear above) first.
              </p>
            )}
            <label className="text-xs font-medium" htmlFor="ai-problem">
              What did the user report?
            </label>
            <Textarea
              id="ai-problem"
              value={problem}
              onChange={(event) => setProblem(event.target.value)}
              placeholder="Paste the customer's words, e.g. 下午三点左右连着 Wi-Fi 突然断了，重连也连不上"
              className="text-xs min-h-24 max-h-60"
            />
            <div className="flex items-center gap-2">
              {run?.running ? (
                <button
                  type="button"
                  onClick={stop}
                  className="h-7 px-3 rounded-md border text-xs font-medium hover:bg-muted inline-flex items-center gap-1.5"
                >
                  <Square className="size-3" />
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={start}
                  disabled={!problem.trim() || needsKey || !settings}
                  className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <Sparkles className="size-3" />
                  Find it in the log
                </button>
              )}
              <span className="text-[10px] text-muted-foreground">
                Opus 5.5 · log text is redacted before it is sent
              </span>
            </div>
          </div>

          {run && (run.answer || run.error) && (
            <div className="text-xs whitespace-pre-wrap leading-relaxed select-text">
              {renderAnswer(run.answer)}
              {run.error && <p className="text-red-500 mt-2">{run.error}</p>}
            </div>
          )}

          {run && run.steps.length > 0 && (
            <details open={run.running} className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer select-none inline-flex items-center gap-1.5">
                {run.running && <Loader2 className="size-3 animate-spin" />}
                {run.steps.length} step{run.steps.length === 1 ? "" : "s"}
              </summary>
              <ol className="mt-1 flex flex-col gap-0.5 pl-4 list-decimal">
                {run.steps.map((step, index) => (
                  <li key={index} className="break-words">
                    {renderAnswer(step)}
                  </li>
                ))}
              </ol>
            </details>
          )}

          {run?.running && run.steps.length === 0 && (
            <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <Loader2 className="size-3 animate-spin" />
              Reading the overview…
            </div>
          )}
        </details>

        {marks.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Key lines
            </div>
            {marks.map((mark) => (
              <button
                key={mark.ref}
                type="button"
                onClick={() => onJumpToLine(mark.key, mark.index)}
                className={cn(
                  "text-left rounded-md border border-l-2 p-1.5 hover:bg-muted/60 transition-colors flex flex-col gap-0.5 min-w-0",
                  AI_MARK_STYLE[mark.kind].border
                )}
              >
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span
                    className={cn("rounded px-1 py-px font-medium", AI_MARK_STYLE[mark.kind].chip)}
                  >
                    {mark.kind}
                  </span>
                  <span className="font-mono text-muted-foreground">{mark.ref}</span>
                </div>
                <span className="text-xs">{mark.note}</span>
                <span className="text-[10px] font-mono truncate text-muted-foreground min-w-0">
                  {parsedLogs[mark.key]?.[mark.index]?.message}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
