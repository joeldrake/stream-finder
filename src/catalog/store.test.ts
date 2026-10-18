import { describe, expect, it } from "vite-plus/test";
import { etagMatches } from "./store";

describe("etagMatches", () => {
  it("matchar samma etagg", () => {
    expect(etagMatches('"abc"', '"abc"')).toBe(true);
  });

  it("matchar en svag etagg som Cloudflare har gjort om", () => {
    expect(etagMatches('W/"abc"', '"abc"')).toBe(true);
  });

  it("matchar en av flera etaggar", () => {
    expect(etagMatches('"x", W/"abc"', '"abc"')).toBe(true);
  });

  it("matchar *", () => {
    expect(etagMatches("*", '"abc"')).toBe(true);
  });

  it("matchar inte en annan etagg eller en saknad header", () => {
    expect(etagMatches('W/"abd"', '"abc"')).toBe(false);
    expect(etagMatches(undefined, '"abc"')).toBe(false);
  });
});
