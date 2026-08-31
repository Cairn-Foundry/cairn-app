# Contributing to Cairn Foundry

Thanks for wanting to help. This file covers the legal side of a contribution;
the technical side lives in [CLAUDE.md](CLAUDE.md) and the README.

## Developer Certificate of Origin

Every commit must be signed off. Signing off means you certify the
[Developer Certificate of Origin 1.1](https://developercertificate.org/): that
you wrote the contribution or otherwise have the right to submit it under the
project's license.

Add the sign-off with `git commit -s`, which appends the trailer:

```
Signed-off-by: Your Name <your.email@example.com>
```

The name must be your real name and the address one you can be reached at.
Anonymous or pseudonymous contributions cannot be accepted.

## Licensing of contributions

You keep the copyright on what you write. By contributing, you license your
contribution to the project and to everyone else under the
AGPL-3.0-or-later, the same license as the rest of the code.

New files carry the standard header:

```
// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
```

## Trademarks

The license covers the code, not the name or the logo. See
[TRADEMARK.md](TRADEMARK.md).

## Before opening a merge request

```bash
bun run check      # svelte-check + TypeScript
bun run lint       # Biome
bun run test:all   # Vitest + cargo test
```

Every user-visible change also adds its line to the in-development entry of
`src/lib/data/changelog.json`, in both `en` and `fr`.
