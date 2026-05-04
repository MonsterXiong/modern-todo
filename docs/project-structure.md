# Project Structure

```text
.
├── docs/                  Project and release documentation
├── scripts/               Local automation scripts
├── src/                   React and TypeScript frontend
│   ├── lib/               Client API, date helpers, task rules, stats
│   ├── App.tsx            Main desktop UI
│   └── App.css            UI styling
├── src-tauri/             Tauri shell, Rust backend, SQLite migrations
│   ├── capabilities/      Tauri permission model
│   ├── icons/             Windows app icon
│   ├── migrations/        SQLx migrations
│   └── src/               Rust commands and startup code
└── package.json           Frontend, test, and packaging scripts
```

## Engineering Rules

- Use `npm test` before packaging.
- Use `npm run build` before Tauri builds.
- Use `scripts/package.ps1` for one-command Windows packaging.
- Keep all persistent user data under `~/.modern-todo`.
- Keep Tauri command access behind `src/lib/api.ts`; UI components should not call `invoke` directly.
