import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps custom UI font-size utilities when merging text colors", () => {
    expect(cn("text-ui-caption", "text-success")).toBe(
      "text-ui-caption text-success",
    );
    expect(cn("text-ui-caption", "text-ui-muted")).toBe(
      "text-ui-caption text-ui-muted",
    );
    expect(cn("text-ui-caption", "text-primary")).toBe(
      "text-ui-caption text-primary",
    );
    expect(cn("text-ui-title", "text-foreground", "text-success")).toBe(
      "text-ui-title text-success",
    );
  });
});
