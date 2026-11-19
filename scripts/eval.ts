import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "../src/eval.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "..", "results", "eval.json");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(evaluate(), null, 2) + "\n", "utf8");
