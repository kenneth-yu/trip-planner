import { readdirSync, readFileSync } from "node:fs";
import { concreteRoutes, routesTouched } from "./changed-routes-lib.mjs";

const pages = readdirSync("src/app", { recursive: true, encoding: "utf8" })
  .filter((entry) => entry.endsWith("page.tsx") && (entry === "page.tsx" || entry.endsWith("/page.tsx")))
  .map((entry) => `src/app/${entry}`);

const all = process.argv.includes("--all");
const changed = all
  ? []
  : readFileSync(0, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
const total = Number.parseInt(process.env.CHANGED_TOTAL ?? "", 10);
const trusted = all || (changed.length > 0 && Number.isInteger(total) && total < 3000);

const selected = all || !trusted ? pages : routesTouched(changed, pages);
process.stdout.write(`${concreteRoutes(selected).join(",")}\n`);
