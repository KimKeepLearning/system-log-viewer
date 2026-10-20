import { randomUUID } from "crypto";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { BrowserWindow, ipcMain, IpcMainEvent } from "electron";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getMcpToken, getSourceRoot } from "../ai/settings";
import { readSource, searchSource } from "../ai/source";

export const MCP_PORT = 47615;
const RENDERER_TIMEOUT_MS = 30_000;

export interface McpStatus {
  url: string;
  token: string;
  listening: boolean;
  error: string | null;
}

let status: McpStatus | null = null;
const pendingCalls = new Map<string, (result: string) => void>();

const INSTRUCTIONS = `System Log Viewer is the desktop app the engineer has open with a ChromeOS / VibeOS feedback log archive loaded. These tools read that archive and highlight lines in the engineer's log view.

Typical use: the engineer pastes what a customer reported, often in Chinese, and asks you to find it in the log.
1. Call get_overview first: device, boots, known failure patterns, and every section with its id, size and time span.
2. search_logs with the words the code would log, in English: component names, error strings, D-Bus names, feature tags. Narrow by section or level when a search is noisy.
3. read_logs around a hit to see what led up to it and what followed.
4. A line's source location, like chrome/browser/foo.cc:123, names the code that wrote it. read_source and search_source read the checkout configured in the app, to learn what a line means and what else that code path logs.
5. mark_line the few lines that carry the story -- cause, user-visible symptom, context that dates them -- as you confirm them. They light up in the app immediately. Call clear_marks when starting a new investigation.

Cite lines by ref (e.g. s3:1520) so the engineer can find them. Prefer evidence over guesses, and say what is missing when the log does not hold the answer. Log text is redacted before you see it: placeholders like <ip-1> stand for the same value wherever they appear.`;

const askRenderer = (name: string, input: unknown): Promise<string> =>
  new Promise((resolve) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window || window.webContents.isDestroyed()) {
      resolve("System Log Viewer has no open window.");
      return;
    }
    const callId = randomUUID();
    const timer = setTimeout(() => {
      pendingCalls.delete(callId);
      resolve("System Log Viewer did not answer in time.");
    }, RENDERER_TIMEOUT_MS);
    pendingCalls.set(callId, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    window.webContents.send("mcp:tool-call", { callId, name, input });
  });

const report = (name: string, input: unknown) => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window && !window.webContents.isDestroyed()) {
    window.webContents.send("mcp:activity", { name, input, at: Date.now() });
  }
};

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

const fromRenderer = (name: string) => async (input: unknown) => {
  report(name, input);
  return text(await askRenderer(name, input));
};

const NO_CHECKOUT =
  "No source checkout is set. The engineer can choose one in System Log Viewer under Ask Claude → settings.";

const buildServer = () => {
  const server = new McpServer(
    { name: "system-log-viewer", version: "1.0.0" },
    { instructions: INSTRUCTIONS }
  );

  server.registerTool(
    "get_overview",
    {
      description:
        "Overview of the open archive: device, report time, boots, known failure patterns, and every section with its id, line and error counts and wall-clock span.",
      annotations: { readOnlyHint: true }
    },
    () => fromRenderer("get_overview")({})
  );

  server.registerTool(
    "search_logs",
    {
      description:
        "Search every parsed log line, case-insensitive. Returns up to `limit` matches (max 100) as `ref | time | section | level | process | source | message`, plus the total count.",
      inputSchema: {
        query: z.string().describe("Text to find"),
        regex: z
          .boolean()
          .default(false)
          .describe("Treat query as a JavaScript regular expression"),
        section: z
          .string()
          .nullable()
          .default(null)
          .describe("Only this section id (e.g. s3) or name"),
        level: z.string().nullable().default(null).describe("Only ERROR, WARN, INFO or DEBUG"),
        limit: z.number().int().default(50)
      },
      annotations: { readOnlyHint: true }
    },
    fromRenderer("search_logs")
  );

  server.registerTool(
    "read_logs",
    {
      description:
        "Read the lines around a ref in its own section (max 150 each side). The ref line is marked with '>'.",
      inputSchema: {
        ref: z.string(),
        before: z.number().int().default(20),
        after: z.number().int().default(20)
      },
      annotations: { readOnlyHint: true }
    },
    fromRenderer("read_logs")
  );

  server.registerTool(
    "mark_line",
    {
      description:
        "Highlight a line in the engineer's log view with a one-sentence note, written in the language of the complaint.",
      inputSchema: {
        ref: z.string(),
        kind: z.enum(["cause", "symptom", "context"]),
        note: z.string()
      }
    },
    fromRenderer("mark_line")
  );

  server.registerTool(
    "clear_marks",
    { description: "Remove every highlight, before starting a new investigation." },
    () => fromRenderer("clear_marks")({})
  );

  server.registerTool(
    "read_source",
    {
      description:
        "Read a file from the source checkout around a line. `path` may be a log source location such as ../../chrome/browser/foo.cc:123.",
      inputSchema: {
        path: z.string(),
        line: z.number().int().nullable().default(null),
        context: z.number().int().default(40).describe("Lines each side, max 120")
      },
      annotations: { readOnlyHint: true }
    },
    async ({ path, line, context }) => {
      report("read_source", { path, line });
      const root = getSourceRoot();
      return text(root ? readSource(root, path, line, context) : NO_CHECKOUT);
    }
  );

  server.registerTool(
    "search_source",
    {
      description:
        "git grep (extended regex) in the source checkout. Scope `path` to a directory such as chrome/browser/ash; the whole tree is slow.",
      inputSchema: { pattern: z.string(), path: z.string() },
      annotations: { readOnlyHint: true }
    },
    async ({ pattern, path }) => {
      report("search_source", { pattern, path });
      const root = getSourceRoot();
      return text(root ? await searchSource(root, pattern, path) : NO_CHECKOUT);
    }
  );

  return server;
};

const handle = async (req: IncomingMessage, res: ServerResponse, token: string) => {
  if (req.url?.split("?")[0] !== "/mcp") {
    res.writeHead(404).end();
    return;
  }
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end("Unauthorized");
    return;
  }
  // Stateless: every request gets its own server and transport, which is all
  // a handful of read tools needs and leaves nothing to clean up.
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableDnsRebindingProtection: true,
    allowedHosts: [`127.0.0.1:${MCP_PORT}`, `localhost:${MCP_PORT}`]
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
};

export const startMcpServer = (): void => {
  const token = getMcpToken();
  status = { url: `http://127.0.0.1:${MCP_PORT}/mcp`, token, listening: false, error: null };

  const http = createServer((req, res) => {
    handle(req, res, token).catch((error) => {
      console.error("[MCP] request failed:", error);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  http.on("error", (error: NodeJS.ErrnoException) => {
    status = {
      ...status!,
      listening: false,
      error:
        error.code === "EADDRINUSE"
          ? `Port ${MCP_PORT} is in use, probably by another System Log Viewer window.`
          : error.message
    };
  });
  http.listen(MCP_PORT, "127.0.0.1", () => {
    status = { ...status!, listening: true, error: null };
  });

  ipcMain.handle("mcp:status", () => status);
  ipcMain.on(
    "mcp:tool-result",
    (_event: IpcMainEvent, payload: { callId: string; result: string }) => {
      const resolve = pendingCalls.get(payload.callId);
      pendingCalls.delete(payload.callId);
      resolve?.(payload.result);
    }
  );
};
