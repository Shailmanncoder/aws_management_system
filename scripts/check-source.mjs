// Repository self-review gate (run in CI). Fails on patterns that must never ship.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "scripts", "prisma"];
const SKIP = [/src[\\/]generated[\\/]/, /node_modules/];
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (SKIP.some((r) => r.test(p))) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|mjs|js|sql|prisma)$/.test(p)) files.push(p);
  }
};
ROOTS.forEach(walk);

// Control characters (excluding tab/newline/CR) and Unicode line/paragraph separators,
// built from char codes so this file itself stays plain ASCII.
const ctrl = [];
for (let c = 0; c < 32; c++) if (c !== 9 && c !== 10 && c !== 13) ctrl.push(c);
ctrl.push(0x2028, 0x2029);
const controlChars = new RegExp(`[${ctrl.map((c) => String.fromCharCode(c).replace(/[\]\\^-]/g, "\\$&")).join("")}]`);

const checks = [
  { name: "raw control character", re: controlChars },
  { name: "dangerouslySetInnerHTML", re: /dangerouslySetInnerHTML/ },
  { name: "console.* call", re: /\bconsole\.(log|debug|info|warn|error)\(/, skip: [/scripts[\\/]/] },
  { name: "TODO/FIXME/HACK marker", re: /(\/\/|\/\*|^\s*\*).*\b(TODO|FIXME|HACK|XXX)\b/ },
  { name: "explicit any", re: /:\s*any\b|\bas any\b|<any>/ },
  { name: "AWS access key id literal", re: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/, skip: [/fixtures[\\/]/] },
  { name: "eval / new Function", re: /\beval\(|new Function\(/ },
  { name: "client import of server code", re: /from ["']@\/server\//, only: [/src[\\/]components[\\/]/, /src[\\/]lib[\\/]/] },
];

const problems = [];
for (const f of files.filter((x) => !/check-source\.mjs$/.test(x))) {
  const lines = readFileSync(f, "utf8").split("\n");
  for (const c of checks) {
    if (c.skip?.some((r) => r.test(f))) continue;
    if (c.only && !c.only.some((r) => r.test(f))) continue;
    lines.forEach((line, i) => {
      if (c.re.test(line)) problems.push(`${f}:${i + 1}  ${c.name}`);
    });
  }
}
if (problems.length) {
  process.stderr.write(`Source check failed (${problems.length}):\n${problems.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Source check passed (${files.length} files).\n`);
