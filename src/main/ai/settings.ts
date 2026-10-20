import { app, safeStorage } from "electron";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";

const keyPath = () => join(app.getPath("userData"), "anthropic-key.bin");
const settingsPath = () => join(app.getPath("userData"), "ai-settings.json");

interface StoredSettings {
  sourceRoot: string | null;
  mcpToken?: string;
}

export interface AiSettings {
  hasKey: boolean;
  sourceRoot: string | null;
}

const readStored = (): StoredSettings => {
  try {
    return { sourceRoot: null, ...JSON.parse(readFileSync(settingsPath(), "utf8")) };
  } catch {
    return { sourceRoot: null };
  }
};

export const getApiKey = (): string | null => {
  if (!existsSync(keyPath())) return null;
  try {
    return safeStorage.decryptString(readFileSync(keyPath()));
  } catch {
    return null;
  }
};

/** The key is written encrypted and never handed back to the renderer. */
export const setApiKey = (key: string | null): void => {
  if (!key) {
    rmSync(keyPath(), { force: true });
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("This system has no keyring to encrypt the API key with");
  }
  writeFileSync(keyPath(), safeStorage.encryptString(key.trim()));
};

export const getSourceRoot = (): string | null => readStored().sourceRoot;

export const setSourceRoot = (sourceRoot: string | null): void => {
  writeFileSync(settingsPath(), JSON.stringify({ ...readStored(), sourceRoot }));
};

/**
 * Generated once and kept, so `claude mcp add` is run once rather than after
 * every restart. It only guards a port bound to 127.0.0.1.
 */
export const getMcpToken = (): string => {
  const stored = readStored();
  if (stored.mcpToken) return stored.mcpToken;
  const mcpToken = randomBytes(24).toString("base64url");
  writeFileSync(settingsPath(), JSON.stringify({ ...stored, mcpToken }));
  return mcpToken;
};

export const getSettings = (): AiSettings => ({
  hasKey: getApiKey() !== null,
  sourceRoot: getSourceRoot()
});
