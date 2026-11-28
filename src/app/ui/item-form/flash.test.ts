import { describe, expect, it } from "vitest";
import { TIP_KINDS } from "@/domain/smarts/kinds";
import { FLASH_TEXT, TIP_HIDDEN_FLASH } from "./flash";

describe("the message after Hide tips like this", () => {
  it("names the kind and says how to turn it back on", () => {
    expect(FLASH_TEXT[TIP_HIDDEN_FLASH.bags]).toBe("Bag storage tips are off. Turn them back on in Account.");
    expect(FLASH_TEXT[TIP_HIDDEN_FLASH.airport]).toBe("Airport tips are off. Turn them back on in Account.");
  });

  it("has a message for every kind", () => {
    for (const kind of TIP_KINDS) expect(FLASH_TEXT[TIP_HIDDEN_FLASH[kind]]).toContain("tips are off");
  });
});
