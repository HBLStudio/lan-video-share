const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TARGETS = ["src", "public", "scripts", "test"];
const TEXT_EXTENSIONS = new Set([".js", ".css", ".html", ".json", ".md"]);
const failures = [];

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }

    const text = fs.readFileSync(fullPath, "utf8");
    if (text.includes("\t")) {
      failures.push(`${path.relative(ROOT, fullPath)} contains tabs`);
    }
    if (!text.endsWith("\n")) {
      failures.push(`${path.relative(ROOT, fullPath)} is missing trailing newline`);
    }
  }
}

for (const target of TARGETS) {
  walk(path.join(ROOT, target));
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("lint ok");
}
