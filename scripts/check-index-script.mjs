import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const html = readFileSync("public/index.html", "utf8");
const match = html.match(/<script\s+type="module">([\s\S]*?)<\/script>/i);

if (!match) {
  console.error("Could not find the module script in public/index.html.");
  process.exit(1);
}

const tempPath = join(tmpdir(), `retirement-index-script-${process.pid}.mjs`);
writeFileSync(tempPath, match[1], "utf8");

try {
  const result = spawnSync(process.execPath, ["--check", tempPath], {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
} finally {
  rmSync(tempPath, { force: true });
}
