import { app, safeStorage } from "electron";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const keyPath = () => join(app.getPath("userData"), "anthropic-key.bin");
const settingsPath = () => join(app.getPath("userData"), "ai-settings.json");

interface StoredSettings {
  sourceRoot: string | null;
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

export const getSettings = (): AiSettings => ({
  hasKey: getApiKey() !== null,
  sourceRoot: getSourceRoot()
});
