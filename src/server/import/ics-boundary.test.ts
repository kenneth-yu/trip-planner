import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function restrictedImports(file: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(process.cwd(), file) });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-imports");
}

const IMPORT = 'import ICAL from "ical.js";\nexport const parsed = ICAL;\n';

describe("ical.js is imported in one place", () => {
  it.each(["src/domain/time/other.ts", "src/domain/import/pipeline.ts", "src/server/services/other.ts", "src/app/other.ts", "src/server/import/other.ts"])("refuses an import in %s and names the allowed file", async (file) => {
    const found = await restrictedImports(file, IMPORT);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("src/domain/import/ics.ts");
  });

  it.each(["ical.js/dist/ical.js", "ical.js/subpath", "ical.js/dist/types/module.js"])("refuses the subpath import %s outside src/domain/import/ics.ts", async (specifier) => {
    const code = `import * as parts from "${specifier}";\nexport const x = parts;\n`;
    for (const file of ["src/domain/time/other.ts", "src/server/services/other.ts", "src/app/other.ts", "src/domain/time/luxon.ts"]) {
      const found = await restrictedImports(file, code);
      expect(found, file).toHaveLength(1);
      expect(found[0]?.message).toContain("src/domain/import/ics.ts");
    }
    expect(await restrictedImports("src/domain/import/ics.ts", code)).toEqual([]);
  });

  it("applies in src/domain/time/luxon.ts, which only needs luxon itself", async () => {
    expect(await restrictedImports("src/domain/time/luxon.ts", IMPORT)).toHaveLength(1);
    expect(await restrictedImports("src/domain/time/luxon.ts", 'import { DateTime } from "luxon";\nexport { DateTime };\n')).toEqual([]);
  });

  it("allows the import in src/domain/import/ics.ts", async () => {
    expect(await restrictedImports("src/domain/import/ics.ts", IMPORT)).toEqual([]);
  });

  it("still applies the other restrictions in src/domain/import/ics.ts", async () => {
    const found = await restrictedImports("src/domain/import/ics.ts", 'import { DateTime } from "luxon";\nimport fs from "node:fs";\nexport const x = [DateTime, fs];\n');
    expect(found).toHaveLength(2);
  });
});
