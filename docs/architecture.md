# Community Core and Enterprise extensions

Veriqorn follows an open-core model. The Community Core is published under
Apache-2.0 and can run without a product license. Enterprise capabilities are
separate, proprietary extensions installed alongside the Core.

## Stable boundary

The public contracts package defines product-facing API and domain types. The
extension SDK defines the supported integration boundary between the Core and
an extension. Extensions register their own routes, UI contributions, schema
contributions, and service implementations through that SDK.

Core does not contain Enterprise implementation code or license-issuer
material. It discovers installed extensions at runtime and exposes only the
capabilities supplied by those extensions.

## Licensing at runtime

An Enterprise installation receives a signed license document containing
entitlements, such as `ai.analysis`, `ai.rag`, or `sso`. The application
verifies that document locally with a public key; it does not need to contact a
license server to make ordinary entitlement decisions. An extension checks an
entitlement through the shared capability layer before serving a protected
feature.

This runtime product license is separate from the Apache-2.0 source license:
the former enables an installed Enterprise capability, while the latter governs
use of the public Community Core source code.

## Contributions

Contributions to this repository are accepted under the
[Developer Certificate of Origin](../DCO.md). Sign each commit with
`git commit -s`; pull-request CI verifies the sign-off.

The Veriqorn name and logo are not granted for forks or derivative products.
See [TRADEMARKS.md](../TRADEMARKS.md).
