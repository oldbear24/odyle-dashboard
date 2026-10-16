# Security

Please report a security problem privately, not in a public issue: use **Security → Report a vulnerability** on this repository (GitHub's private vulnerability reporting). Say what is affected (the dashboard, the backend, a route or a release), how to reproduce it and what an attacker gains.

The maintainer answers there. A fix goes out as a release like any other (every push to `main` releases); the advisory is published once servers can update.

Only the newest release is supported. The Windows app has its own policy in [oldbear24/odyle-windows](https://github.com/oldbear24/odyle-windows/security).

Out of scope: rate limits being reachable, missing security headers on `/_/` and `/api/` (documented in docs/deployment.md), and findings that need a superuser account.
