import type { TtsConfig } from "./config";

const DB_NAME = "lang-agent-tts-cache";
const STORE_NAME = "audio";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("无法打开朗读缓存"));
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
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 操作失败"));
  });
}

export async function buildTtsCacheKey(
  text: string,
  cfg: TtsConfig,
): Promise<string> {
  const payload = JSON.stringify({
    text,
    voice: cfg.voice,
    model: cfg.model,
    stylePrompt: cfg.stylePrompt,
    baseUrl: cfg.baseUrl,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getCachedSpeech(key: string): Promise<ArrayBuffer | null> {
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
    console.warn("读取朗读缓存失败:", e);
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
      tx.onerror = () => reject(tx.error ?? new Error("写入朗读缓存失败"));
    });
    db.close();
  } catch (e) {
    console.warn("写入朗读缓存失败:", e);
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
    tx.onerror = () => reject(tx.error ?? new Error("清空朗读缓存失败"));
  });
  db.close();
  return count;
}
