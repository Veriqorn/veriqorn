# Veriqorn

Veriqorn is a self-hosted quality intelligence platform for test runs,
reports, history, APIs, dashboards, and extensibility.

This repository is the Apache-2.0 licensed Community Core. Enterprise
capabilities are distributed separately as proprietary licensed extensions and
are not included here.

## Status

The Community Core source is available now:

- [`backend`](backend) is the Community API and runtime.
- [`frontend`](frontend) is the Community web UI.
- [`@veriqorn/contracts`](packages/contracts) provides stable API and domain
  contracts.
- [`@veriqorn/extension-sdk`](packages/extension-sdk) provides the framework-
  light contracts for Community and Enterprise extensions.

The default extension manifest is empty. Enterprise capabilities are supplied
by separately distributed proprietary extensions and are not part of this
repository or its Community images.

## Verify locally

Requires Bun 1.3.11.

```sh
bun install --frozen-lockfile
bun run check
```

Read the [Community Core and Enterprise extension architecture](docs/architecture.md)
for the stable boundary, runtime licensing model, and contribution rules.
For the maintainer-only artifact process, see the
[Community release procedure](docs/releases.md).

## License

Copyright 2026 Veriqorn contributors. Licensed under the
[Apache License 2.0](LICENSE).

## Security

Please do not report security vulnerabilities in public issues. See
[SECURITY.md](SECURITY.md).
