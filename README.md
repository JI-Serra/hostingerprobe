# Hostinger Capability Probe

This repository is a disposable, standalone Next.js probe used to qualify a Hostinger account before the MetriBar ERP is initialized. It contains no ERP business code and must not be treated as the ERP repository.

## Local verification

```sh
npm ci
npm run audit:runbook
npm run test:probe
node --test verify.test.mjs
npm audit --package-lock-only --omit=dev --audit-level=high
npm run build
```

## Production commands

Hostinger must use the repository root as the application root:

| Purpose | Command |
|---|---|
| Install | `npm ci` |
| Build | `npm run build` |
| Start | `npm start` |

`npm start` runs `node .next/standalone/server.js`. Do not add credentials to the repository. Copy `.env.example` only into Hostinger's environment-variable interface and keep actual values out of Git and evidence.

Set a strong `PROBE_ACCESS_TOKEN` only in Hostinger. Health remains public; every state, database, migration, and scheduled endpoint requires `Authorization: Bearer <token>`. The smoke command reads the token from its environment.

Use `PROBE_MYSQL_SERVER`, `PROBE_MYSQL_TCP`, and `PROBE_MYSQL_SCHEMA` for the Hostinger database server, TCP port, and schema. `PROBE_DB_HOST`, `PROBE_DB_PORT`, and `PROBE_DB_NAME` remain supported only as local compatibility fallbacks. Database credentials continue to use only `PROBE_DB_USER` and `PROBE_DB_PASSWORD`.

## Evidence boundary

Generated evidence, redacted logs, and runtime state are ignored by Git. The verifier requires evidence logs to be local files beneath `evidence/logs/` and validates their SHA-256 checksums.

The Spanish operator runbook is maintained in the MetriBar source workspace at `docs/deployment/hostinger-probe-runbook.md`; it is intentionally not linked here because this standalone repository does not contain that parent path.
