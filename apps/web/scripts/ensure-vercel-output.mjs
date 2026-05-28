import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const cwd = process.cwd();
const candidates = [resolve(cwd, "dist"), resolve(cwd, "apps", "web", "dist"), resolve(cwd, "..", "..", "apps", "web", "dist")];
const source = candidates.find((candidate) => existsSync(resolve(candidate, "index.html")));

if (!source) {
  throw new Error(`Could not find Vite output. Checked: ${candidates.join(", ")}`);
}

const targets = [
  resolve(cwd, "dist"),
  resolve(cwd, "apps", "web", "dist"),
  resolve(cwd, "..", "..", "dist"),
  resolve(cwd, "..", "..", "apps", "web", "dist")
];

for (const target of targets) {
  if (target === source) continue;
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

writeFileSync(resolve(source, ".vercel-output-ok"), new Date().toISOString());
console.log(`Vercel output confirmed at ${source}`);
console.log(`cwd=${cwd}`);
for (const target of targets) {
  console.log(`${existsSync(resolve(target, "index.html")) ? "OK" : "MISSING"} ${target}`);
}
