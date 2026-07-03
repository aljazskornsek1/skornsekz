// Objavi statični redesign v outputs/ (Vercel servira outputs/).
import fs from "node:fs";
import path from "node:path";
const src = path.resolve("redesign");
const out = path.resolve("outputs");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, f), path.join(out, f));
}
console.log("Redesign kopiran v outputs/:", fs.readdirSync(out).join(", "));
