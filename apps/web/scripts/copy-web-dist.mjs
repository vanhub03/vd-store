import { existsSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve("dist");

if (!existsSync(output)) {
  throw new Error(`Missing storefront build output: ${output}`);
}

console.log(`Storefront output ready: ${output}`);
