# Community dependency audit ? 2026-11-08

Registry snapshot and work started 2026-11-07; verification completed 2026-11-08.
Only stable npm latest releases were selected. Transitive packages follow their
parents' compatible ranges, with explicitly documented security overrides.
Bun is pinned to 1.4.4; Node.js 26 LTS is pinned to 26.13.0 in .node-version and CI.
Product/SDK release numbers and published release metadata are unchanged.

## Result

- bun run audit: 0 known advisories; 326 packages checked.
- bun outdated --recursive: no outdated direct dependencies.
- bun install --frozen-lockfile: passes.
- bun run check: passes, including backend lint/typecheck/build, 56 backend
  tests (3 with PostgreSQL), frontend lint/typecheck/build, 33 frontend tests,
  and both public SDK package checks.
- Community backend and frontend Docker images build on Bun 1.4.4.
- Isolated container smoke tests: fresh database bootstrap, health, login,
  authenticated project reads and frontend delivery pass.

## Compatibility work

- TypeORM 1.1.2: object relation selectors, getPendingMigrations for migration
  baselining, and timestamp default functions. All 32 packaged migrations are
  discovered and recorded against a new PostgreSQL database. Tests also verify
  relation loading and rejection of undefined query identifiers.
- cookie 2.0.2: parseCookie/stringifySetCookie, explicit encodeURIComponent to
  preserve the previous authentication-cookie format.
- TanStack Router: use ErrorComponentProps and narrow unknown errors before
  reading their message.
- Removed the obsolete standalone frontend/bun.lock; install from the repository
  root using the workspace bun.lock.
- Removed outdated brace-expansion and uuid overrides after the TypeORM graph
  stopped requiring those old pins.

## Security overrides

MinIO 8.0.7 is still the latest stable SDK. Its query-string 7 dependency brings
an affected decode-uri-component, and stream-json 1 is also affected. The root
overrides select query-string 10.0.0 and stream-json 3.8.0. A checked-in Bun patch
adapts MinIO's source, ESM and CommonJS imports and JSONL stream factory.
See [patch maintenance notes](../patches/README.md).

Regression tests cover signed URLs, object upload/download, version query values
and notifications. The CommonJS entry point was also verified on Node 26.13.0.
Docker install stages copy patches before both regular and production installs.

Existing compatible fast-xml-parser/builder, PostCSS and ws security overrides
were refreshed. Transitive major versions are not forced indiscriminately.

## Tooling and ongoing checks

Both Community CI checks use Node 26.13.0, Bun 1.4.4, audit and an isolated
PostgreSQL 14 service. Locally, VERIQORN_TEST_DATABASE_URL enables the database
suite, which creates and drops only randomly named test databases.

Oxlint 1.92 adds React Compiler diagnostics to the correctness category.
react/set-state-in-effect and react/immutability remain visible at warning level
for the existing form synchronization and extension bridge patterns (8 current
warnings); existing checks, including rules-of-hooks, remain enforced.
Builds also report existing chunk-size and runtime-config script warnings.

The deployment update-agent uses Node 26.13.0-alpine with Alpine package updates;
the matching installer-repository Dockerfile was kept identical and its image
was built and syntax-checked.

## Scope

This checks known advisories in the npm graph. PostgreSQL, MinIO server, reverse
proxy images and the full OS package graph were not vulnerability-scanned.
No production deployment, registry publishing, SDK publishing, release version
bump or running local stack replacement was performed.

See [the complete current dependency inventory](dependency-inventory-2026-11-08.json).

## Updated declarations

| Manifest | Dependency | Before | After |
| --- | --- | --- | --- |
| backend/package.json | adm-zip | 0.6.0 | 0.6.1 |
| backend/package.json | cookie | 1.1.1 | 2.0.2 |
| backend/package.json | dotenv | 17.4.2 | 18.0.9 |
| backend/package.json | elysia | 1.4.29 | 1.4.31 |
| backend/package.json | jose | 6.2.8 | 6.2.15 |
| backend/package.json | pg | 8.22.0 | 8.23.1 |
| backend/package.json | typeorm | 0.3.31 | 1.1.2 |
| backend/package.json | zod | 4.4.3 | 4.6.7 |
| backend/package.json | @types/node | 26.1.2 | 26.6.6 |
| backend/package.json | bun-types | 1.4.2 | 1.4.4 |
| backend/package.json | oxlint | 1.77.0 | 1.92.0 |
| frontend/package.json | @radix-ui/react-avatar | 1.2.6 | 1.3.1 |
| frontend/package.json | @radix-ui/react-checkbox | 1.3.11 | 1.4.1 |
| frontend/package.json | @radix-ui/react-dialog | 1.1.23 | 1.3.1 |
| frontend/package.json | @radix-ui/react-dropdown-menu | 2.1.24 | 2.2.1 |
| frontend/package.json | @radix-ui/react-label | 2.1.15 | 2.1.17 |
| frontend/package.json | @radix-ui/react-radio-group | 1.4.7 | 1.5.1 |
| frontend/package.json | @radix-ui/react-select | 2.3.7 | 2.4.1 |
| frontend/package.json | @radix-ui/react-separator | 1.1.15 | 1.2.0 |
| frontend/package.json | @radix-ui/react-slot | 1.3.3 | 1.5.0 |
| frontend/package.json | @radix-ui/react-switch | 1.3.7 | 1.4.1 |
| frontend/package.json | @radix-ui/react-tabs | 1.1.21 | 1.2.1 |
| frontend/package.json | @tanstack/react-query | 5.101.4 | 5.107.1 |
| frontend/package.json | @tanstack/react-router | 1.170.18 | 1.170.46 |
| frontend/package.json | lucide-react | 1.28.0 | 1.70.0 |
| frontend/package.json | react | 19.2.8 | 19.3.1 |
| frontend/package.json | react-dom | 19.2.8 | 19.3.1 |
| frontend/package.json | @tailwindcss/vite | 4.3.3 | 4.3.5 |
| frontend/package.json | @types/node | 26.1.2 | 26.6.6 |
| frontend/package.json | @types/react | 19.2.18 | 19.3.0 |
| frontend/package.json | @types/react-dom | 19.2.4 | 19.3.0 |
| frontend/package.json | @vitejs/plugin-react | 6.0.5 | 6.2.1 |
| frontend/package.json | jsdom | 30.0.1 | 31.0.0 |
| frontend/package.json | oxlint | 1.77.0 | 1.92.0 |
| frontend/package.json | tailwind-merge | 3.6.0 | 3.7.0 |
| frontend/package.json | tailwindcss | 4.3.3 | 4.3.5 |
| frontend/package.json | vite | 8.2.0 | 8.3.6 |
| frontend/package.json | vitest | 4.1.10 | 5.1.0 |
| packages/contracts/package.json | zod | ^4.3.6 | ^4.6.7 |
| packages/contracts/package.json | typescript | ^7.0.0 | ^7.0.2 |
| packages/extension-sdk/package.json | typescript | ^7.0.0 | ^7.0.2 |

## Upstream references

- [Bun 1.4.4](https://bun.com/blog/bun-v1.4.4)
- [TypeORM migration guide](https://typeorm.io/docs/releases/1.0/upgrading-from-0.3/)
- [Cookie 2 release notes](https://github.com/jshttp/cookie/releases)
- [Vitest migration guide](https://vitest.dev/guide/migration/)
- [Node.js releases](https://nodejs.org/dist/index.json)
