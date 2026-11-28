import { describe, expect, it } from "vitest";
import { TIP_KINDS } from "@/domain/smarts/kinds";
import { FLASH_TEXT, TIP_HIDDEN_FLASH } from "./flash";
import { parseFlash } from "./flash-status";

describe("a flash cookie left over from an older version", () => {
  it("the retired tip_hidden value is ignored without throwing", () => {
    expect(parseFlash("tip_hidden")).toBeNull();
    expect(parseFlash("")).toBeNull();
    expect(parseFlash("tip_hidden_nonsense")).toBeNull();
  });

  it("every current value is still understood", () => {
    expect(parseFlash("tip_hidden_bags")).toBe("tip_hidden_bags");
    expect(parseFlash("saved")).toBe("saved");
  });
});

describe("the message after Hide tips like this", () => {
  it("names the kind and says how to turn it back on", () => {
    expect(FLASH_TEXT[TIP_HIDDEN_FLASH.bags]).toBe("Bag storage tips are off. Turn them back on in Account.");
    expect(FLASH_TEXT[TIP_HIDDEN_FLASH.airport]).toBe("Airport tips are off. Turn them back on in Account.");
  });

  it("has a message for every kind", () => {
    for (const kind of TIP_KINDS) expect(FLASH_TEXT[TIP_HIDDEN_FLASH[kind]]).toContain("tips are off");
  });
});
