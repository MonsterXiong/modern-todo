const fs = require("node:fs");
const path = require("node:path");

const repo = process.env.GITHUB_REPOSITORY;
const pubkey = process.env.TAURI_UPDATER_PUBKEY;

if (!repo) {
  throw new Error("GITHUB_REPOSITORY is required, for example owner/repo.");
}

if (!pubkey) {
  throw new Error("TAURI_UPDATER_PUBKEY is required. Store the Tauri updater public key as a GitHub Actions secret.");
}

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "src-tauri", "tauri.conf.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

config.bundle = {
  ...config.bundle,
  createUpdaterArtifacts: true
};

config.plugins = {
  ...config.plugins,
  updater: {
    pubkey,
    endpoints: [`https://github.com/${repo}/releases/latest/download/latest.json`],
    windows: {
      installMode: "passive"
    }
  }
};

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Updater endpoint configured for https://github.com/${repo}/releases/latest/download/latest.json`);
