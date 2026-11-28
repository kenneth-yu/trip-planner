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
    'page.getByRole("button", { name: "Save", ...rest })',
    'page.getByRole("button", opts)',
    'page.getByRole("button", { "name": "Save" })',
    'page.getByLabel("Name", opts)',
    'page.getByLabel("Name", { ...rest })',
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
  ])("allows %s", (code) => {
    expect(problems(code)).toEqual([]);
  });

  it("leaves the text, placeholder, title and alt text locators alone on purpose: a phrase inside a longer paragraph is often what a test means, and an exact match cannot be proven right without running the page", () => {
    expect(problems('page.getByText("lose access"); page.getByPlaceholder("Name"); page.getByTitle("Close"); page.getByAltText("Logo")')).toEqual([]);
  });

  it("offers a fix only for an object literal it can complete", () => {
    const linter = new Linter();
    const config: Linter.Config[] = [{ files: ["**/*.js"], plugins: { principles: { rules: { "exact-names": exactNames } } }, rules: { "principles/exact-names": "error" } }];
    expect(linter.verifyAndFix('page.getByRole("button", { name: "Save" }); page.getByLabel("Name"); page.getByRole("button", opts)', config, "spec.js").output).toBe(
      'page.getByRole("button", { name: "Save", exact: true }); page.getByLabel("Name", { exact: true }); page.getByRole("button", opts)',
    );
  });

  it("reports each offending call once", () => {
    expect(problems('page.getByLabel("A"); page.getByLabel("B"); page.getByLabel("C", { exact: true })')).toHaveLength(2);
  });
});
