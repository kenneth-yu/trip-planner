import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import { exactNames } from "../../tools/eslint-rules/exact-names.mjs";

function problems(code: string): string[] {
  const linter = new Linter();
  const messages = linter.verify(code, [{ files: ["**/*.js"], plugins: { principles: { rules: { "exact-names": exactNames } } }, rules: { "principles/exact-names": "error" } }], "spec.js");
  return messages.map((m) => m.message.split(".")[0] ?? "");
}

describe("exact names in end to end locators", () => {
  it.each([
    'page.getByRole("button", { name: "Save" })',
    "page.getByRole('link', { name: `Edit ${title}` })",
    'page.getByRole("button", { name: "Save", exact: false })',
    'page.getByLabel("Name")',
    'page.getByLabel("Name", { exact: false })',
    'kenny.getByRole("heading", { name: "Asia" }).first()',
  ])("rejects %s", (code) => {
    expect(problems(code)).toEqual(["Add exact: true"]);
  });

  it.each([
    'page.getByRole("button", { name: "Save", exact: true })',
    'page.getByRole("link", { name: /^Back to / })',
    'page.getByRole("status")',
    'page.getByRole("status").filter({ hasText: "Saved" })',
    'page.getByRole("button", { name: title })',
    'page.getByLabel("Name", { exact: true })',
    "page.getByLabel(/name/i)",
    'page.getByText("x")',
    'page.getByRole("button", { name: "Save", ...rest })',
  ])("allows %s", (code) => {
    expect(problems(code)).toEqual([]);
  });

  it("reports each offending call once", () => {
    expect(problems('page.getByLabel("A"); page.getByLabel("B"); page.getByLabel("C", { exact: true })')).toHaveLength(2);
  });
});
