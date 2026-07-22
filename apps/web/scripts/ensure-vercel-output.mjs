import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const cwd = process.cwd();
const packageJsonPath = resolve(cwd, "package.json");
const packageName = existsSync(packageJsonPath) ? JSON.parse(readFileSync(packageJsonPath, "utf8")).name : null;
const source = packageName === "@vd-store/web" ? resolve(cwd, "dist") : resolve(cwd, "apps", "web", "dist");

if (!existsSync(resolve(source, "index.html"))) {
  throw new Error(`Could not find Vite output at ${source}`);
}

writeFileSync(resolve(source, ".vercel-output-ok"), new Date().toISOString());
console.log(`Vercel output confirmed at ${source}`);
console.log(`cwd=${cwd}`);
