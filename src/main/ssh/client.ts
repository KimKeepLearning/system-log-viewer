import { Client, ClientChannel, ConnectConfig } from "ssh2";
import * as fs from "fs";

export interface SSHTarget extends ConnectConfig {
  privateKeyPath?: string;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type FollowState =
  | "connecting"
  | "reconnecting"
  | "streaming"
  | "waiting"
  | "error"
  | "gave-up"
  | "stopped";

export interface FollowStatus {
  id: string;
  state: FollowState;
  attempt: number;
  /** Milliseconds until the next attempt, while waiting. */
  delay?: number;
  message?: string;
}

export interface FollowHandlers {
  onData: (chunk: string) => void;
  onStatus: (status: FollowStatus) => void;
}

const targetKey = (target: SSHTarget): string =>
  `${target.username ?? ""}@${target.host ?? ""}:${target.port ?? 22}`;

const pool = new Map<string, Promise<Client>>();

const openConnection = (target: SSHTarget): Promise<Client> =>
  new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on("ready", () => resolve(conn));
    conn.on("error", (err) => reject(err));
    conn.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => target.password || ""));
    });

    try {
      const config: ConnectConfig = { ...target, tryKeyboard: true, keepaliveInterval: 15000 };
      if (target.privateKeyPath) {
        config.privateKey = fs.readFileSync(target.privateKeyPath.replace(/^~/, homeDir()));
      }
      delete (config as SSHTarget).privateKeyPath;
      conn.connect(config);
    } catch (e) {
      reject(e);
    }
  });

const homeDir = (): string => process.env.HOME || process.env.USERPROFILE || "";

// One connection per device, reused across reads and commands: a pull is
// usually several round trips and each fresh handshake costs a second.
export const connect = async (target: SSHTarget): Promise<Client> => {
  const key = targetKey(target);
  const existing = pool.get(key);
  if (existing) {
    try {
      const conn = await existing;
      // A pooled client whose transport died would reject every later request.
      if (pool.get(key) === existing) return conn;
    } catch {
      pool.delete(key);
    }
  }

  const pending = openConnection(target);
  pool.set(key, pending);

  try {
    const conn = await pending;
    const drop = () => {
      if (pool.get(key) === pending) pool.delete(key);
    };
    conn.on("close", drop);
    conn.on("end", drop);
    conn.on("error", drop);
    return conn;
  } catch (err) {
    pool.delete(key);
    throw err;
  }
};

export const disconnect = async (target: SSHTarget): Promise<void> => {
  const key = targetKey(target);
  const pending = pool.get(key);
  pool.delete(key);
  if (!pending) return;
  try {
    (await pending).end();
  } catch {
    // Already gone.
  }
};

export const readRemoteFile = async (target: SSHTarget, filePath: string): Promise<string> => {
  const conn = await connect(target);

  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);

      const stream = sftp.createReadStream(filePath);
      const chunks: Buffer[] = [];

      stream.on("data", (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      stream.on("error", reject);
    });
  });
};

export const execCommand = async (target: SSHTarget, command: string): Promise<ExecResult> => {
  const conn = await connect(target);

  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);

      let stdout = "";
      let stderr = "";

      stream.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      stream.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      stream.on("close", (code: number | null) => resolve({ code, stdout, stderr }));
      stream.on("error", reject);
    });
  });
};

/**
 * Runs a packaging command on the device, then pulls back what it wrote. This
 * is the "generate the logs on the DUT" path, which used to mean doing it by
 * hand over ssh and copying the file across.
 */
export const collect = async (
  target: SSHTarget,
  command: string,
  remotePath: string
): Promise<string> => {
  const result = await execCommand(target, command);
  if (result.code !== 0 && result.code !== null) {
    throw new Error(`Command exited with ${result.code}: ${result.stderr || result.stdout}`);
  }
  return readRemoteFile(target, remotePath);
};

interface FollowSession extends FollowHandlers {
  target: SSHTarget;
  command: string;
  stream?: ClientChannel;
  attempts: number;
  stopped: boolean;
  timer?: NodeJS.Timeout;
}

const follows = new Map<string, FollowSession>();

const MAX_RECONNECT_ATTEMPTS = 10;
const backoffMs = (attempt: number): number => Math.min(30000, 1000 * 2 ** attempt);

const scheduleReconnect = (id: string, session: FollowSession): void => {
  if (session.attempts >= MAX_RECONNECT_ATTEMPTS) {
    session.onStatus({
      id,
      state: "gave-up",
      attempt: session.attempts,
      message: `Gave up after ${session.attempts} attempts`
    });
    follows.delete(id);
    return;
  }

  const delay = backoffMs(session.attempts);
  session.attempts++;
  session.onStatus({ id, state: "waiting", attempt: session.attempts, delay });
  session.timer = setTimeout(() => openFollow(id, session), delay);
};

/**
 * A DUT drops its connection whenever it suspends, reboots or loses Wi-Fi, and
 * that is exactly when the interesting lines appear. The session survives it:
 * the stream restarts with backoff and the caller is told which state it is in
 * rather than the output silently going quiet.
 */
const openFollow = async (id: string, session: FollowSession): Promise<void> => {
  if (session.stopped) return;

  session.onStatus({
    id,
    state: session.attempts === 0 ? "connecting" : "reconnecting",
    attempt: session.attempts
  });

  try {
    const conn = await connect(session.target);
    const stream = await new Promise<ClientChannel>((resolve, reject) => {
      conn.exec(session.command, { pty: true }, (err, channel) => {
        if (err) reject(err);
        else resolve(channel);
      });
    });

    if (session.stopped) {
      stream.close();
      return;
    }

    session.stream = stream;
    session.attempts = 0;
    session.onStatus({ id, state: "streaming", attempt: 0 });

    stream.on("data", (chunk: Buffer) => session.onData(chunk.toString()));
    stream.stderr.on("data", (chunk: Buffer) => session.onData(chunk.toString()));
    stream.on("close", () => {
      session.stream = undefined;
      if (session.stopped) {
        session.onStatus({ id, state: "stopped", attempt: 0 });
        follows.delete(id);
        return;
      }
      scheduleReconnect(id, session);
    });
  } catch (err) {
    if (session.stopped) return;
    session.onStatus({
      id,
      state: "error",
      attempt: session.attempts,
      message: err instanceof Error ? err.message : String(err)
    });
    scheduleReconnect(id, session);
  }
};

export const startFollow = (
  id: string,
  target: SSHTarget,
  command: string,
  handlers: FollowHandlers
): void => {
  stopFollow(id);

  const session: FollowSession = { ...handlers, target, command, attempts: 0, stopped: false };
  follows.set(id, session);
  void openFollow(id, session);
};

export const stopFollow = (id: string): void => {
  const session = follows.get(id);
  if (!session) return;

  session.stopped = true;
  if (session.timer) clearTimeout(session.timer);
  if (session.stream) {
    session.stream.close();
  } else {
    session.onStatus({ id, state: "stopped", attempt: 0 });
    follows.delete(id);
  }
};
