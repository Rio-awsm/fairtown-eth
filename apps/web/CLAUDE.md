# Stream 3 rules
- Phaser 4.2.x, React 19 template. Phaser draws world; React draws HUD and pages; EventBus and store connect them.
- Data from relay client and API client. Types from @fairtown/shared only. No write keys in the browser.
- Scene logic is a pure reducer. Expose window.__TOWN__ read-only outside production.
- Money formatting goes through src/money/format.ts with the lot's currency. Local display is labelled approximate.
- Assets CC0 or licensed, in CREDITS.md. No crypto words on /sell, /scan, /walkin. Always show LIVE or REPLAY and TEST MONEY.
- Import @fairtown/shared through subpaths only (/protocol, /units, /keys, /api, /handover). The root index pulls in node:fs.
- Full test command: `pnpm -F web test && pnpm -F web e2e && pnpm -F web build`.
