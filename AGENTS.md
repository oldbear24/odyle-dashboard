# Working in this repository

Instructions for every agent (and person) changing this repository. `CLAUDE.md` imports this file.

## Versioning

Odyle uses semantic versions, **MAJOR.MINOR.PATCH**. The version lives in `package.json` (`"version"`, and the same line in `package-lock.json`). Every push to `main` that changes what ships publishes a release tagged with exactly that version: the GitHub release, the server ZIPs and the container image `ghcr.io/oldbear24/odyle-dashboard:<version>`.

**Every change that ships bumps the version once, in the same pull request, by the largest kind of change it contains:**

| Bump | When | Examples |
| --- | --- | --- |
| **MAJOR** (x.0.0) | Something that worked stops working without action from users or operators | Removing or retyping a JSON field installed Windows apps or open dashboards read; a route or action removed; a migration that cannot run on top of the previous release; a required new environment variable |
| **MINOR** (0.x.0) | New behaviour that keeps everything that worked working | A feature, a new page, route, action, setting or optional field; a migration that only adds fields or collections |
| **PATCH** (0.0.x) | No new behaviour | A bug fix, wording, styling, performance, a refactor, a dependency update |

- Reset the lower parts: 0.6.3 plus a feature is 0.7.0; 0.7.0 plus a breaking change is 1.0.0.
- One pull request with several changes bumps once, by the largest. Pull requests open side by side each bump from the version on `main`; before the second one merges, bump it again above the first, or its release fails. A pull request stacked on another bumps from that one's version.
- What does not ship needs no bump and makes no release: `docs/` (except `docs/privacy.md`, which the dashboard shows), Markdown files, `tests/`, `.github/`, `scripts/`, `*_test.go`, `compose.yaml` (an example for operators, in no release), lint and editor settings (`scripts/version.mjs` has the exact list).
- Change the version with an edit of that one line (or `npm version <x.y.z> --no-git-tag-version`, then undo any other reformatting it does).
- Name the bump in the pull request description ("Version 0.6.0 → 0.7.0: new features").
- Add the version's section to `CHANGELOG.md` in the same pull request: `## 0.7.0 · <date>`, then `### New`, `### Changed` and/or `### Fixed` with `- ` entries written for players (what they can now do or what works again), not commit messages. The release notes and the dashboard's **What's new** page show it; the version check fails without it.

`node scripts/version.mjs check` runs in the checks of every pull request and branch: it fails when shipped files changed and the version is not higher than on `main`, unless `main`'s version was never released (its release failed), in which case the change goes out with it. The release workflow runs `node scripts/version.mjs release`: it fails when shipped code changed since an already released version, or when the version is not above every earlier release (the releases before semantic versions were tagged `0.5.0.<run number>`, up to `v0.5.0.24`).

The Windows app (oldbear24/odyle-windows) versions itself the same way in its own repository; the two version independently.
