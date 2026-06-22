import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appState: new Map<string, string>(),
  generate: vi.fn<() => Promise<string>>(),
  getProvider: vi.fn(),
  getAppState: vi.fn(),
  setAppState: vi.fn(),
}));

vi.mock("../config", () => ({
  getProvider: mocks.getProvider,
  loadConfig: () => ({
    targetLanguage: "English",
    nativeLanguage: "Chinese",
  }),
}));

vi.mock("../db/app-state", () => ({
  getAppState: mocks.getAppState,
  setAppState: mocks.setAppState,
}));

function mockLocalStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    }),
  });
  return data;
}

async function loadModule() {
  vi.resetModules();
  return import("./dictation-translate");
}

beforeEach(() => {
  mocks.appState.clear();
  mocks.generate.mockReset();
  mocks.getProvider.mockReset();
  mocks.getAppState.mockReset();
  mocks.setAppState.mockReset();
  mocks.getProvider.mockResolvedValue({
    generate: mocks.generate,
    stream: vi.fn(),
  });
  mocks.getAppState.mockImplementation((key: string) =>
    Promise.resolve(mocks.appState.get(key) ?? null),
  );
  mocks.setAppState.mockImplementation((key: string, value: string) => {
    mocks.appState.set(key, value);
    return Promise.resolve();
  });
  vi.unstubAllGlobals();
});

describe("translateForPrompt", () => {
  it("reads cached translations from SQLite app_state before calling the provider", async () => {
    const { DICTATION_TRANSLATIONS_STATE_KEY, translateForPrompt } =
      await loadModule();
    mocks.appState.set(
      DICTATION_TRANSLATIONS_STATE_KEY,
      JSON.stringify({ "English»Chinese»Hello.": "你好。" }),
    );

    await expect(translateForPrompt("Hello.")).resolves.toBe("你好。");
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("dedupes concurrent provider calls for the same sentence", async () => {
    const { DICTATION_TRANSLATIONS_STATE_KEY, translateForPrompt } =
      await loadModule();
    mocks.generate.mockResolvedValue("你好。");

    await expect(
      Promise.all([translateForPrompt("Hello."), translateForPrompt("Hello.")]),
    ).resolves.toEqual(["你好。", "你好。"]);

    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(mocks.appState.get(DICTATION_TRANSLATIONS_STATE_KEY) ?? "{}"),
    ).toMatchObject({ "English»Chinese»Hello.": "你好。" });
  });

  it("migrates the legacy localStorage cache into app_state", async () => {
    const legacyKey = "lang-agent.dictation-translations";
    const legacyStore = mockLocalStorage({
      [legacyKey]: JSON.stringify({ "English»Chinese»Hello.": "你好。" }),
    });
    const { DICTATION_TRANSLATIONS_STATE_KEY, translateForPrompt } =
      await loadModule();

    await expect(translateForPrompt("Hello.")).resolves.toBe("你好。");

    expect(mocks.generate).not.toHaveBeenCalled();
    expect(
      JSON.parse(mocks.appState.get(DICTATION_TRANSLATIONS_STATE_KEY) ?? "{}"),
    ).toMatchObject({ "English»Chinese»Hello.": "你好。" });
    expect(legacyStore.has(legacyKey)).toBe(false);
  });
});
