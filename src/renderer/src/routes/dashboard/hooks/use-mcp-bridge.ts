import { useEffect, useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { aiMarksAtom, logFilesAtom, mcpActivityAtom, parsedLogsMapAtom } from "@renderer/lib/atom";
import { createLogTools } from "@renderer/lib/ai-tools";
import { createRedactor } from "@renderer/lib/log-redact";

const MAX_ACTIVITY = 50;

/**
 * Lets Claude Code read the open archive through the app's MCP server. One
 * redactor per archive keeps a placeholder meaning the same value across every
 * call Claude makes against it.
 */
export const useMcpBridge = () => {
  const logFiles = useAtomValue(logFilesAtom);
  const parsedLogs = useAtomValue(parsedLogsMapAtom);
  const setMarks = useSetAtom(aiMarksAtom);
  const setActivity = useSetAtom(mcpActivityAtom);

  const tools = useMemo(
    () =>
      createLogTools(logFiles, parsedLogs, createRedactor(), (mark) =>
        setMarks((current) => [...current.filter((entry) => entry.ref !== mark.ref), mark])
      ),
    [logFiles, parsedLogs, setMarks]
  );

  useEffect(
    () =>
      window.api.mcp.serve((name, input) => {
        if (name === "get_overview") return tools.context();
        if (name === "clear_marks") {
          setMarks([]);
          return "Cleared.";
        }
        return tools.call(name, input);
      }),
    [tools, setMarks]
  );

  useEffect(
    () =>
      window.api.mcp.onActivity((activity) =>
        setActivity((current) => [...current, activity].slice(-MAX_ACTIVITY))
      ),
    [setActivity]
  );

  return tools;
};
