import { afterEach, describe, expect, it, vi } from "vitest";
import { REFRESH_SKEW_MS, tokensFromResponse } from "./store";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tokensFromResponse", () => {
  it("maps fields and subtracts refresh skew from expires", () => {
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const t = tokensFromResponse(
      JSON.stringify({
        access_token: "a",
        refresh_token: "r",
        expires_in: 3600,
      }),
    );
    expect(t).toEqual({
      access: "a",
      refresh: "r",
      expires: now + 3600 * 1000 - REFRESH_SKEW_MS,
    });
  });

  it("merges extra fields like accountId", () => {
    const t = tokensFromResponse(
      JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 60 }),
      { accountId: "acct_1" },
    );
    expect(t.accountId).toBe("acct_1");
  });

  it("throws when required fields are missing", () => {
    expect(() =>
      tokensFromResponse(JSON.stringify({ access_token: "a" })),
    ).toThrow();
  });
});
