# Veriqorn frontend

React 19 frontend built with Vite and TypeScript 7.

## Quality checks

Run from this directory:

```sh
bun run lint       # Oxlint
bun run typecheck  # TypeScript 7
bun run test:run
bun run build
bun run check      # all of the above
```

Oxlint is configured in [`.oxlintrc.json`](./.oxlintrc.json). Its configuration enables correctness checks and React Hooks validation.
