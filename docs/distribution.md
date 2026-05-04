# Distribution Notes

## Offline Distribution

Modern TODO is a local-first desktop app. The Windows installer can be distributed offline after it is built.

Build release packages:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package.ps1
```

Build debug packages:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package.ps1 -Profile debug
```

Use a lockfile-clean dependency reinstall only when no dev server or app process is holding files in `node_modules`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package.ps1 -CleanInstall
```

Outputs:

- `src-tauri/target/release/bundle/nsis/*.exe`
- `src-tauri/target/release/bundle/msi/*.msi`
- `src-tauri/target/debug/bundle/nsis/*.exe` when using `-Profile debug`
- `src-tauri/target/debug/bundle/msi/*.msi` when using `-Profile debug`
- `release/v<version>/<profile>/` with copied installers and `SHA256SUMS.txt`

The built installer includes the frontend bundle and Tauri runtime code. Users do not need Node, Rust, npm, Cargo, or SQLite installed.

## Local Data

Runtime data is stored under the current user's home directory:

```text
~/.modern-todo/todo.sqlite
```

On Windows this resolves to:

```text
C:\Users\<username>\.modern-todo\todo.sqlite
```

If an older build already created data in Tauri's default app data directory, the app copies the old `todo.sqlite` into `~/.modern-todo/todo.sqlite` on first startup when the new file does not already exist.

## Update Strategy

Online updates for a Tauri desktop app are handled with Tauri's updater plugin and signed release artifacts. Do not ship unsigned self-updating code.

The app checks GitHub Releases for:

```text
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

Offline behavior: if the user is offline or GitHub cannot be reached, update checks are skipped and local data remains available.

## GitHub Release CI

The release workflow is defined in `.github/workflows/release.yml`.

It runs when pushing a tag like:

```bash
git tag v0.1.1
git push origin v0.1.1
```

The workflow:

1. Syncs `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` to the tag version.
2. Installs dependencies.
3. Runs tests.
4. Injects updater config using `scripts/prepare-updater-config.cjs`.
5. Builds the Windows app with Tauri.
6. Uploads installer assets and `latest.json` to the GitHub Release.

## Updater Signing Keys

Generate a signing key once:

```powershell
npm run tauri signer generate -- -w "$HOME\.modern-todo-updater.key"
```

Use a strong password and store both the key file and password in a password manager. Losing the private key means already-installed apps cannot trust future updates.

Add these GitHub Actions secrets:

- `TAURI_UPDATER_PUBKEY`: public key printed by the signer command.
- `TAURI_SIGNING_PRIVATE_KEY`: full private key file content.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: private key password.

The app embeds only the public key. The private key must never be committed.
