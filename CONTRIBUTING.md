# Contributing

**`main` is production.** Every push to `main` that changes what ships publishes a release and a container image that the live server runs, so changes go through pull requests whose checks pass.

- Follow [AGENTS.md](AGENTS.md): every change that ships bumps the version (MAJOR.MINOR.PATCH) once and adds its section to `CHANGELOG.md`, written for players.
- Run the checks before opening a pull request: `npm run lint`, `npm test`, `npm run test:backend`, `npm run build`, and for UI changes `npm run test:ui` (see the README for the integration and UI test setup).
- Keep API changes additive: installed Windows apps and open dashboards parse the answers (docs/api.md lists the fields).
- Character data comes only from the game's packets or PLAYNC's official pages; nothing about a character is typed in or overridden.
- Report security problems privately ([SECURITY.md](SECURITY.md)).
