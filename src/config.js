const path = require("node:path");

function parseArgs(argv) {
  const result = {
    rootDir: "",
    host: process.env.HOST || "0.0.0.0",
    port: Number.parseInt(process.env.PORT || "8080", 10),
    token: process.env.SHARE_TOKEN || ""
  };

  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--port") {
      result.port = Number.parseInt(args.shift() || "", 10);
    } else if (arg === "--host") {
      result.host = args.shift() || result.host;
    } else if (arg === "--token") {
      result.token = args.shift() || "";
    } else if (!arg.startsWith("--") && !result.rootDir) {
      result.rootDir = arg;
    }
  }

  if (!result.rootDir) {
    result.rootDir = process.env.SHARE_DIR || process.cwd();
  }

  if (!Number.isInteger(result.port) || result.port < 1 || result.port > 65535) {
    throw new Error("Port must be a number between 1 and 65535.");
  }

  return {
    ...result,
    rootDir: path.resolve(result.rootDir)
  };
}

module.exports = {
  parseArgs
};
