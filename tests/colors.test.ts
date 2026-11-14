import { describe, expect, it } from "vitest";
import { mix, withAlpha } from "../client/colors";

describe("colors", () => {
  it("lays a tint over a base as one opaque color", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("rgb(128, 128, 128)");
    expect(mix("#16171c", "rgb(224, 138, 100)", 0)).toBe("rgb(22, 23, 28)");
    expect(mix("rgba(0, 0, 0, 1)", "#e08a64", 1)).toBe("rgb(224, 138, 100)");
  });

  it("keeps the base when it cannot read a color", () => {
    expect(mix("hsl(0 0% 10%)", "#fff", 0.5)).toBe("hsl(0 0% 10%)");
  });

  it("still gives a translucent color where one is wanted", () => {
    expect(withAlpha("#ffffff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
  });
});
