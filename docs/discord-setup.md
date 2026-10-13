# Discord sign-in setup

The dashboard uses PocketBase's built-in Discord OAuth2 flow. First Discord sign-in creates the local account; subsequent sign-ins load the same account, memberships and saved characters. Password authentication and direct public account creation are disabled.

## Configure the provider

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. In **OAuth2**, copy the application's client ID and client secret. You do not need a Discord bot or guild membership permissions.
3. Add the exact callback for your PocketBase backend:
   - Local: `http://127.0.0.1:8090/api/oauth2-redirect`
   - Hosted: `https://your-backend.example.com/api/oauth2-redirect`
4. Copy `.env.backend.example` to `.env.backend` and put the real ID and secret there. This file is ignored by Git and excluded from Docker build context. It is loaded by `npm run backend` and inherited by PocketBase.
5. Restart the backend. The bootstrap hook enables the Discord provider using these backend environment variables. Alternatively, configure Discord directly in the PocketBase `users` collection's OAuth2 options; the hook preserves that configuration when environment variables are absent.
6. Open the dashboard and click **Continue with Discord**. Allow its sign-in popup. PocketBase exchanges the authorization code server-side; the browser saves only the application's account token in tab-scoped storage.

For Docker add `env_file: .env.backend` under the `odyle` service in Compose. Keep the secret out of all `VITE_*` variables: those are embedded in the browser build. Both Discord variables must be set together.

The default Discord provider requests identity/email to establish the PocketBase account. It does not request access to messages, guild administration or a bot. The frontend uses the returned account display name; it does not retain Discord access/refresh tokens.

## Pair the Windows app

Sign in on the dashboard, open **My rooms & characters**, and choose **Pair Windows app**, then **Copy connection link**. Click **Paste link & connect** in your own Windows companion; the link includes the backend address, so you do not have to type it. The 16-character code is carried in the URL fragment, expires after five minutes, is stored only as a digest, and can be consumed once. Generating a new link revokes your previous unused code.

The Windows app receives a PocketBase token for that same account and stores it using DPAPI. It lists existing characters, shows where each is shared and lists online party members; rooms, invitations and sharing are managed on the dashboard. New character readings come from its packet reader under the `global-reference-v1` adapter name. Manual entry is disabled. Room invitation codes and desktop pairing codes serve different purposes.

## Verification limits

Automated tests use synthetic accounts in an isolated temporary PocketBase instance; there is no test sign-in endpoint in production. A local mock supplies Discord token/user responses while PocketBase performs the real OAuth code exchange, first account creation, identity linking and repeat login. Tests also verify Discord is the only enabled provider, direct public registration is closed, pairing is one-use, account authorization is enforced, and saved values survive a real server restart.

A complete live Discord sign-in requires your own Discord application's credentials and registered callback. This external round trip has not been exercised without those credentials.

## First-login permission error

If first sign-in reports **Only superusers can perform this action**, update to the latest repository version and restart PocketBase so migration `1791763202_discord_registration.js` is applied. The `users` create rule must be `@request.context = "oauth2"`: PocketBase checks it while creating a new OAuth account. A locked (`null`) rule also blocks Discord signup. The context is assigned by PocketBase; direct account creation remains denied and password sign-in stays disabled. The migration preserves existing users, rooms, characters and provider configuration.

Reference: [PocketBase OAuth2 setup and callback](https://pocketbase.io/docs/authentication/#oauth2-integration), [Discord OAuth2 documentation](https://discord.com/developers/docs/topics/oauth2).
