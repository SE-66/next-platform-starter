import { describe, expect, it } from "vitest";
import {
  normalizeArabiziToken,
  resolveArabiziToken
} from "../src/context";

describe("Lebanese Arabizi context layer", () => {
  it("normalizes case and diacritics", () => {
    expect(normalizeArabiziToken(" Khāl ")).toBe("khal");
  });

  it("keeps same-spelling meanings ambiguous without context", () => {
    const result = resolveArabiziToken("jawze");
    expect(result.ambiguous).toBe(true);
    expect(result.selected).toBeUndefined();
    expect(result.alternatives.map(x => x.meaning)).toContain("my husband");
    expect(result.alternatives.map(x => x.meaning)).toContain("a walnut");
  });

  it("uses context hints to prefer husband for jawze", () => {
    const result = resolveArabiziToken(
      "jawze",
      "my husband came home and said hello"
    );
    expect(result.selected?.meaning).toBe("my husband");
  });

  it("uses context hints to prefer walnut for jawze", () => {
    const result = resolveArabiziToken(
      "jawze",
      "eat the nut with baklava"
    );
    expect(result.selected?.meaning).toBe("a walnut");
  });

  it("returns both meanings for 2mar", () => {
    const result = resolveArabiziToken("2mar");
    expect(result.alternatives.map(x => x.meaning).sort()).toEqual(
      ["gambling", "moon"].sort()
    );
  });

  it("resolves an exact near-homophone independently", () => {
    const result = resolveArabiziToken("shoof");
    expect(result.selected?.meaning).toBe("look / see");
    expect(result.alternatives).toHaveLength(1);
  });

  it("returns all dual meanings for se3a", () => {
    const result = resolveArabiziToken("se3a");
    expect(result.alternatives.map(x => x.meaning)).toEqual(
      expect.arrayContaining(["a watch / clock", "time / an hour"])
    );
  });
});
