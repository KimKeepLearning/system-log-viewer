import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { readSource, searchSource } from "./source";

const MODEL = "claude-opus-5-5";
// Each turn is one look at the log; a real investigation takes a dozen or two.
const MAX_TURNS = 40;

export type AiEvent =
  | { runId: string; type: "text"; text: string }
  | { runId: string; type: "tool"; name: string; input: unknown }
  | { runId: string; type: "done" }
  | { runId: string; type: "error"; message: string };

export interface AiRunRequest {
  problem: string;
  /** Archive overview prepared (and redacted) by the renderer. */
  context: string;
}

interface RunOptions {
  apiKey: string;
  sourceRoot: string | null;
  signal: AbortSignal;
  emit: (event: AiEvent) => void;
  /** Log tools run where the logs are: in the renderer. */
  callRenderer: (name: string, input: unknown) => Promise<string>;
}

const SYSTEM_PROMPT = `You help engineers find the cause of a user-reported problem in a ChromeOS / VibeOS feedback log archive.

You get an overview of the archive and the user's complaint, often in their own words and often in Chinese. The log is far too large to read whole, so you work with tools:
- search_logs finds lines by text or regex. Logs are in English: translate the complaint into the words the code would log (component names, error strings, D-Bus names, feature tags).
- read_logs shows the lines around a hit in its own section. To see another subsystem at the same moment, search that section around the same time.
- read_source and search_source (when available) read the checkout the device was built from. A log line's source location, like chrome/browser/foo.cc:123, tells you exactly which code wrote it; read it to learn what the line means and what else that code path would have logged.
- mark_line highlights a line for the engineer. Mark the few lines that carry the story: the likely cause, the user-visible symptom, and context that dates them. Usually 3 to 10. Mark as you confirm them, not all at the end.

Work from the complaint's time and symptom outward. Prefer evidence over guesses: if a hypothesis has no supporting line, say so and say what would confirm it.

Finish with a short answer in the language of the complaint, in three parts: the conclusion, the evidence (cite lines by their ref, e.g. [s3:1520]), and next steps. If the log does not contain the answer, say what is missing.`;

const nullable = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });

const LOG_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search_logs",
    description:
      "Search every parsed log line. Returns up to `limit` matches (max 100) as `ref | time | section | level | process | source | message`, plus the total count.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to find, case-insensitive" },
        regex: { type: "boolean", description: "Treat query as a JavaScript regular expression" },
        section: { ...nullable("string"), description: "Only this section id (e.g. s3) or name" },
        level: { ...nullable("string"), description: "Only ERROR, WARN, INFO or DEBUG" },
        limit: { type: "integer", description: "How many matches to return" }
      },
      required: ["query", "regex", "section", "level", "limit"],
      additionalProperties: false
    }
  },
  {
    name: "read_logs",
    description:
      "Read the lines around a ref in its own section (max 150 each side), to see what led up to a line and what followed.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string" },
        before: { type: "integer" },
        after: { type: "integer" }
      },
      required: ["ref", "before", "after"],
      additionalProperties: false
    }
  },
  {
    name: "mark_line",
    description: "Highlight a line in the engineer's log view with a one-sentence note.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string" },
        kind: { type: "string", enum: ["cause", "symptom", "context"] },
        note: { type: "string", description: "Why this line matters, in the complaint's language" }
      },
      required: ["ref", "kind", "note"],
      additionalProperties: false
    }
  }
];

const SOURCE_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "read_source",
    description:
      "Read a source file from the checkout around a line. `path` may be a log source location such as ../../chrome/browser/foo.cc:123.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        line: { ...nullable("integer") },
        context: { type: "integer", description: "Lines each side, max 120" }
      },
      required: ["path", "line", "context"],
      additionalProperties: false
    }
  },
  {
    name: "search_source",
    description:
      "git grep (extended regex) in the checkout. Always scope `path` to a directory such as chrome/browser/ash; the whole tree is slow.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" }
      },
      required: ["pattern", "path"],
      additionalProperties: false
    }
  }
];

const ReadSourceInput = z.object({
  path: z.string(),
  line: z.number().int().nullable(),
  context: z.number().int()
});
const SearchSourceInput = z.object({ pattern: z.string(), path: z.string() });

const describeError = (error: unknown): string => {
  if (error instanceof Anthropic.AuthenticationError) return "The API key was rejected.";
  if (error instanceof Anthropic.PermissionDeniedError)
    return "This API key may not use this model.";
  if (error instanceof Anthropic.RateLimitError)
    return "Rate limited by the API; try again shortly.";
  if (error instanceof Anthropic.APIConnectionError) return "Could not reach the API.";
  if (error instanceof Anthropic.APIError) return `API error ${error.status}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
};

export const runInvestigation = async (
  runId: string,
  request: AiRunRequest,
  options: RunOptions
): Promise<void> => {
  const { apiKey, sourceRoot, signal, emit, callRenderer } = options;
  const client = new Anthropic({ apiKey });
  const tools = sourceRoot ? [...LOG_TOOLS, ...SOURCE_TOOLS] : LOG_TOOLS;

  const runTool = async (block: Anthropic.Beta.BetaToolUseBlock): Promise<string> => {
    emit({ runId, type: "tool", name: block.name, input: block.input });
    if (block.name === "read_source" && sourceRoot) {
      const input = ReadSourceInput.parse(block.input);
      return readSource(sourceRoot, input.path, input.line, input.context);
    }
    if (block.name === "search_source" && sourceRoot) {
      const input = SearchSourceInput.parse(block.input);
      return searchSource(sourceRoot, input.pattern, input.path);
    }
    return callRenderer(block.name, block.input);
  };

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `${request.context}\n\n<complaint>\n${request.problem}\n</complaint>`
    }
  ];

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = client.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 32000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "high" },
          // Every turn resends the whole investigation; caching the growing
          // prefix is what keeps a 30-turn run affordable.
          cache_control: { type: "ephemeral" },
          system: SYSTEM_PROMPT,
          tools,
          messages
        },
        { signal }
      );
      stream.on("text", (text) => emit({ runId, type: "text", text }));
      const message = await stream.finalMessage();

      if (message.stop_reason === "refusal") {
        emit({
          runId,
          type: "error",
          message: `The model declined (${message.stop_details?.category ?? "unspecified"}).`
        });
        return;
      }

      messages.push({ role: "assistant", content: message.content });
      if (message.stop_reason === "pause_turn") continue;

      const toolUses = message.content.filter(
        (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use"
      );
      if (message.stop_reason !== "tool_use" || toolUses.length === 0) {
        emit({ runId, type: "done" });
        return;
      }

      const results = await Promise.all(
        toolUses.map(async (block): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          try {
            return { type: "tool_result", tool_use_id: block.id, content: await runTool(block) };
          } catch (error) {
            return {
              type: "tool_result",
              tool_use_id: block.id,
              is_error: true,
              content: describeError(error)
            };
          }
        })
      );
      messages.push({ role: "user", content: results });
    }
    emit({ runId, type: "error", message: `Stopped after ${MAX_TURNS} turns without an answer.` });
  } catch (error) {
    if (signal.aborted) {
      emit({ runId, type: "done" });
      return;
    }
    emit({ runId, type: "error", message: describeError(error) });
  }
};
