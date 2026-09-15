const STORAGE_KEY = "system-log-viewer.ssh-profiles";
const LEGACY_KEY = "ssh_profiles";
const MAX_PROFILES = 20;

/** What to pull once connected: a file already on the device, or a command's output. */
export type SSHSource = "file" | "command";

export interface SSHProfile {
  id: string;
  /** Editable label; defaults to user@host. */
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  source: SSHSource;
  path: string;
  command: string;
  /** Drives the list order, so the device you use lands at the top. */
  lastUsedAt: number;
}

export type SSHProfileInput = Omit<SSHProfile, "id" | "lastUsedAt"> & { id?: string };

const identity = (profile: { host: string; port: number; username: string }): string =>
  `${profile.username}@${profile.host}:${profile.port}`;

// Most recent first, and a stable tiebreak so two devices saved in the same
// millisecond do not swap places between renders.
const ordered = (profiles: SSHProfile[]): SSHProfile[] =>
  [...profiles].sort(
    (a, b) =>
      b.lastUsedAt - a.lastUsedAt || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );

const normalize = (raw: unknown, index: number): SSHProfile | null => {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Partial<SSHProfile> & { lastUsed?: number };
  if (!entry.host || !entry.username) return null;

  const port = entry.port ?? 22;

  return {
    id: entry.id ?? `${Date.now()}-${index}`,
    name: entry.name || identity({ host: entry.host, port, username: entry.username }),
    host: entry.host,
    port,
    username: entry.username,
    password: entry.password,
    privateKeyPath: entry.privateKeyPath,
    source: entry.source === "command" ? "command" : "file",
    path: entry.path ?? "",
    command: entry.command ?? "",
    lastUsedAt: entry.lastUsedAt ?? 0
  };
};

const read = (): SSHProfile[] => {
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_KEY) ?? null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalize).filter((entry): entry is SSHProfile => entry !== null);
  } catch {
    return [];
  }
};

const write = (profiles: SSHProfile[]): SSHProfile[] => {
  const next = ordered(profiles).slice(0, MAX_PROFILES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Not being able to remember a device is not worth interrupting anyone over.
  }
  return next;
};

export const sshProfiles = (): SSHProfile[] => ordered(read());

/** Upserts by device identity, so reconnecting never grows a duplicate row. */
export const saveSSHProfile = (input: SSHProfileInput): SSHProfile[] => {
  const profiles = read();
  const key = identity(input);
  const existing = profiles.find((profile) =>
    input.id ? profile.id === input.id : identity(profile) === key
  );

  const merged: SSHProfile = {
    ...input,
    id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim() || key,
    lastUsedAt: Date.now()
  };

  return write([merged, ...profiles.filter((profile) => profile.id !== merged.id)]);
};

export const removeSSHProfile = (id: string): SSHProfile[] =>
  write(read().filter((profile) => profile.id !== id));

export const renameSSHProfile = (id: string, name: string): SSHProfile[] =>
  write(read().map((profile) => (profile.id === id ? { ...profile, name } : profile)));
