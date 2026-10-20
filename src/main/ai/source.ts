import { execFile } from "child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "fs";
import { isAbsolute, relative, resolve, sep } from "path";

const MAX_CONTEXT_LINES = 120;
const MAX_GREP_HITS = 60;
const GREP_TIMEOUT_MS = 30_000;

/**
 * A log's source location is what chrome printed: "../../chrome/browser/x.cc:12"
 * or an already shortened "ui/views/x.cc:12". Both reduce to a checkout path.
 */
export const normaliseSourcePath = (raw: string): { path: string; line: number | null } => {
  const match = /^(.*?)(?::(\d+))?$/.exec(raw.trim());
  const path = (match?.[1] ?? raw).replace(/^(?:\.\.\/)+/, "").replace(/^\/+/, "");
  return { path, line: match?.[2] ? Number(match[2]) : null };
};

// The path comes from the model, so it is confined to the checkout after
// symlinks are resolved, not just lexically.
const insideRoot = (root: string, path: string): string | null => {
  const realRoot = realpathSync(root);
  const target = resolve(realRoot, path);
  if (!existsSync(target)) return null;
  const real = realpathSync(target);
  const rel = relative(realRoot, real);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return real;
};

export const readSource = (root: string, rawPath: string, line: number | null, context: number) => {
  const { path, line: pathLine } = normaliseSourcePath(rawPath);
  const file = insideRoot(root, path);
  if (!file || !statSync(file).isFile()) {
    return `Not found in the checkout: ${path}. Try search_source with the file name.`;
  }

  const lines = readFileSync(file, "utf8").split("\n");
  const center = line ?? pathLine ?? 1;
  const span = Math.min(Math.max(context, 5), MAX_CONTEXT_LINES);
  const from = Math.max(1, center - span);
  const to = Math.min(lines.length, center + span);

  const body = lines
    .slice(from - 1, to)
    .map(
      (text, offset) =>
        `${String(from + offset).padStart(6)}${from + offset === center ? ">" : " "} ${text}`
    )
    .join("\n");
  return `${path} (lines ${from}-${to} of ${lines.length})\n${body}`;
};

/** `git grep` uses the checkout's index, which is what makes this usable on Chromium. */
export const searchSource = (root: string, pattern: string, pathspec: string) =>
  new Promise<string>((done) => {
    const scope = pathspec.replace(/^(?:\.\.\/)+/, "").replace(/^\/+/, "") || ".";
    execFile(
      "git",
      ["-C", root, "grep", "-n", "-I", "-E", "--max-count=5", "-e", pattern, "--", scope],
      { timeout: GREP_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        // git grep exits 1 for "no match", which is an answer, not a failure.
        if (error && (error as NodeJS.ErrnoException & { code?: number }).code !== 1) {
          done(
            error.killed
              ? `Timed out after ${GREP_TIMEOUT_MS / 1000}s; narrow the path.`
              : `git grep failed: ${error.message}`
          );
          return;
        }
        const hits = stdout.split("\n").filter(Boolean);
        if (hits.length === 0) {
          done("No matches.");
          return;
        }
        const shown = hits.slice(0, MAX_GREP_HITS).map((hit) => hit.slice(0, 300));
        done(
          shown.join("\n") +
            (hits.length > shown.length
              ? `\n… ${hits.length - shown.length} more; narrow the path.`
              : "")
        );
      }
    );
  });
