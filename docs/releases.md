# Community release procedure

The Community images are released from this repository, not from the private
Enterprise integration repository. The workflow accepts a `v*` Git tag or an
explicit manual dispatch with the same version value.

## Release prerequisites

1. The commit is on `main` and the **Public boundary check** workflow is
   successful.
2. The version follows the project release convention, for example `v0.1.0`.
3. The GitHub Actions `GITHUB_TOKEN` has package-write permission and the
   resulting GHCR packages are made public before Community documentation tells
   users to pull them without authentication.
4. The release owner has reviewed the generated SBOM and provenance attached
   to each image in GHCR.

## Publish

Create and push an annotated version tag from the reviewed commit. The
`Release Community images` workflow first repeats the source, test, build, and
container-boundary checks. Only after those checks pass does it publish:

- `ghcr.io/veriqorn/veriqorn-backend:<version>`
- `ghcr.io/veriqorn/veriqorn-frontend:<version>`

Stable tags also receive `:latest`. Each image gets BuildKit provenance, an
SBOM, and a keyless Cosign signature.

## Verify a published digest

Always verify the immutable image digest rather than a mutable tag. The
workflow identity is pinned to the tagged public release workflow:

```sh
cosign verify \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\\.com/Veriqorn/veriqorn/\\.github/workflows/release-community\\.yml@refs/tags/v.*$' \
  ghcr.io/veriqorn/veriqorn-backend@sha256:<digest>
```

The update agent in `veriqorn-install` uses the same identity policy. Do not
change it for Community releases without a coordinated install release.

## Enterprise boundary

Enterprise images are released from a private Enterprise repository and must
use their own identity policy and access control. They must not be published
from this Community workflow.
