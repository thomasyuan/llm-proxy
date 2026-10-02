import * as fs from "fs";
import * as path from "path";

const target = path.resolve("dist/index.js");
if (!fs.existsSync(target)) {
  console.error(`Target not found: ${target}`);
  process.exit(1);
}

const content = fs.readFileSync(target, "utf-8");
if (content.startsWith("#!")) {
  console.log("Shebang already present.");
  process.exit(0);
}

fs.writeFileSync(target, `#!/usr/bin/env node\n${content}`);
fs.chmodSync(target, 0o755);
console.log(`Shebang added to ${target}`);
