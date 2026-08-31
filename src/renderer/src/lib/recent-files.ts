const STORAGE_KEY = "system-log-viewer.recent-files";
const MAX_ENTRIES = 8;

export interface RecentFile {
  /** Absolute path on disk; the archive is re-read rather than cached. */
  path: string;
  name: string;
  openedAt: number;
}

// Every read is wrapped: a private window, cleared site data or a browser that
// blocks storage all throw here, and none of that should stop the app opening.
const read = (): RecentFile[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => entry?.path && entry?.name) : [];
  } catch {
    return [];
  }
};

export const recentFiles = (): RecentFile[] => read();

export const rememberFiles = (files: { path: string; name: string }[]): void => {
  if (files.length === 0) return;
  try {
    const openedAt = Date.now();
    const incoming = files.map((file) => ({ ...file, openedAt }));
    const merged = [
      ...incoming,
      ...read().filter((existing) => !files.some((file) => file.path === existing.path))
    ].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Not being able to remember is not worth interrupting anyone over.
  }
};

export const forgetFile = (path: string): void => {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(read().filter((entry) => entry.path !== path))
    );
  } catch {
    // As above.
  }
};
