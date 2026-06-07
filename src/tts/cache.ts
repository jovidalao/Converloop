import type { TtsConfig } from "./config";

const DB_NAME = "lang-agent-tts-cache";
const STORE_NAME = "audio";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () =>
      reject(req.error ?? new Error("Failed to open TTS cache"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("IndexedDB operation failed"));
  });
}

export async function buildTtsCacheKey(
  text: string,
  cfg: TtsConfig,
): Promise<string> {
  const payload = JSON.stringify({
    text,
    provider: cfg.ttsProvider,
    voice: cfg.voice,
    model: cfg.model,
    stylePrompt: cfg.stylePrompt,
    baseUrl: cfg.baseUrl,
    edgeVoice: cfg.edgeVoice,
    edgeRate: cfg.edgeRate,
    edgePitch: cfg.edgePitch,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getCachedSpeech(
  key: string,
): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const entry = await idbRequest(
      tx.objectStore(STORE_NAME).get(key) as IDBRequest<
        { key: string; audio: ArrayBuffer } | undefined
      >,
    );
    db.close();
    return entry?.audio ?? null;
  } catch (e) {
    console.warn("Failed to read TTS cache:", e);
    return null;
  }
}

export async function setCachedSpeech(
  key: string,
  audio: ArrayBuffer,
): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ key, audio, createdAt: Date.now() });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("Failed to write TTS cache"));
    });
    db.close();
  } catch (e) {
    console.warn("Failed to write TTS cache:", e);
  }
}

export async function getTtsCacheCount(): Promise<number> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const count = await idbRequest(tx.objectStore(STORE_NAME).count());
    db.close();
    return count;
  } catch {
    return 0;
  }
}

export async function clearTtsCache(): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const count = await idbRequest(tx.objectStore(STORE_NAME).count());
  await idbRequest(tx.objectStore(STORE_NAME).clear());
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("Failed to clear TTS cache"));
  });
  db.close();
  return count;
}
