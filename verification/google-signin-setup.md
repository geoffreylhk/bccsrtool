# Google sign-in setup

Website code is prepared locally; Google/Supabase configuration and a real sign-in still need completion. Nothing was deployed.

## Website changes and checks

- Continue with Google on signin.html uses Supabase signInWithOAuth, provider google, and the current origin's account.html callback. Google is an alternative for both registration and sign-in; Supabase manages the account identity.
- Only basic sign-in identity is requested. No offline Google access, Gmail or Drive scopes are requested. Existing Supabase configuration and RLS remain unchanged.
- Duplicate clicks are blocked during redirect; start errors restore the button. Callback cancellation/failure messages do not echo provider error descriptions. Authentication fragments are cleared after the Supabase SDK consumes them.
- A newly created profile can take its display name from Google's full_name. Existing profile names are not overwritten. Email/password signup, reset and profile flows remain supported.
- Updated privacy text and auth asset cache versions. No Google client secret is stored in the repository.
- All 54 tests passed, including Google redirect/provider options, duplicate-click/error handling, callback errors and new/existing profile names, plus the prior screening regressions.

## Step 1 — Google Cloud project

Open https://console.cloud.google.com/ and sign in with the Google account that should own the app. Use the project selector to create a project named BC CSR Screening Tool, or select an existing dedicated project. Creating OAuth credentials does not require adding unrelated Google APIs or services. If Google asks you to accept account terms, complete that yourself.

## Step 2 — Google Auth Platform

Within that project, open Google Auth Platform → Overview → Get started (or Branding if already initialized).

- App name: BC CSR Screening Tool.
- User support/developer contact: an email you monitor; do not invent one.
- Audience: External, so ordinary Google accounts can sign in.
- Homepage: https://www.bccsrtool.ca/
- Privacy: https://www.bccsrtool.ca/privacypolicy.html
- Terms: https://www.bccsrtool.ca/termsofuse.html
- Authorized domain: bccsrtool.ca. Complete Google's domain/brand verification if requested.
- Data Access: openid, https://www.googleapis.com/auth/userinfo.email and https://www.googleapis.com/auth/userinfo.profile only.
- During testing, list your test account if the console requires test users. Review Audience publishing status before public launch; testing status is not a claim of production availability.

## Step 3 — OAuth client

Google Auth Platform → Clients → Create client → Web application.

Authorized JavaScript origins:

- https://www.bccsrtool.ca
- https://bccsrtool.ca (if this host serves the app)
- http://127.0.0.1:5500 for the user's local preview; add the exact local origin actually used if it differs.

Authorized redirect URI (copy the callback shown by Supabase's Google provider panel; for the current project):

https://gsbemjemdiofppgjxiyi.supabase.co/auth/v1/callback

This is Google's redirect to Supabase, not the account.html return URL. Keep the client secret private and paste it only into the Supabase provider settings; do not put it in chat, website JavaScript, Git, screenshots or a frontend environment variable.

## Step 4 — Supabase Google provider

In project gsbemjemdiofppgjxiyi, open Authentication → Providers / Sign In → Google. Enable Google and enter the Google Web client ID and client secret. Keep nonce checks enabled and insecure-email options disabled. Save.

## Step 5 — Supabase app return URLs

Authentication → URL Configuration:

Site URL: https://www.bccsrtool.ca

Allowed return URLs:

- https://www.bccsrtool.ca/account.html
- https://bccsrtool.ca/account.html if serving the apex host
- http://127.0.0.1:5500/account.html for local preview
- Existing reset-password.html return URLs must be retained.

The code returns to account.html on the same origin that started sign-in. Use exact local URLs rather than assuming a different preview port will be allowed. Production Google client configuration and Supabase redirect allowlist are separate settings.

## Step 6 — End-to-end checks and launch

Before publishing the prepared files, verify local Google login returns to the local account page, the email belongs to the selected Google account, profile save/sign-out works, and an existing email/password account remains usable. Test cancellation, a second Google account, and private-profile isolation. Supabase can link identities with the same verified email; verify the expected existing account/profile is retained. Then publish authorized website changes and repeat Google sign-in on the live domain.

User sign-in/Google consent must be completed by the user. No real Google sign-in has yet been tested in this implementation stage.

## Official references

- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/auth/redirect-urls
- https://supabase.com/docs/guides/auth/auth-identity-linking
- https://support.google.com/cloud/answer/15549945
