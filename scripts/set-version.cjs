const fs = require("node:fs");
const path = require("node:path");

const rawVersion = process.argv[2];
if (!rawVersion) {
  throw new Error("Usage: node scripts/set-version.cjs <version-or-tag>");
}

const version = rawVersion.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid semver version: ${rawVersion}`);
}

const root = path.resolve(__dirname, "..");
updateJson(path.join(root, "package.json"), (json) => {
  json.version = version;
});
updateJson(path.join(root, "package-lock.json"), (json) => {
  json.version = version;
  if (json.packages?.[""]) {
    json.packages[""].version = version;
  }
});
updateJson(path.join(root, "src-tauri", "tauri.conf.json"), (json) => {
  json.version = version;
});

const cargoPath = path.join(root, "src-tauri", "Cargo.toml");
const cargo = fs.readFileSync(cargoPath, "utf8");
fs.writeFileSync(cargoPath, cargo.replace(/^version = ".+"/m, `version = "${version}"`));

console.log(`Version set to ${version}`);

function updateJson(filePath, mutate) {
  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  mutate(json);
  fs.writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`);
}
