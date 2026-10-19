# Authentication abuse protection: implementation and activation

## Verified so far

- Connected project `gsbemjemdiofppgjxiyi` (`bccsrtool`) reports `ACTIVE_HEALTHY`.
- Source sends email sign-in, signup and recovery requests directly to Supabase Auth.
- Actual project rate limits, CAPTCHA enforcement, SMTP quotas, and billing alerts remain unverified: the dashboard browser requires sign-in and the connected tools do not expose Auth configuration.
- No load test, live signup, password-reset email, or production authentication change was performed.

## Website changes

- `auth-captcha.js` loads Turnstile only on the guest sign-in page, and only once a public site key is configured.
- Each email form has an independent widget/token. Missing, expired and failed checks block requests. Each attempt resets the widget/token, including failed authentication requests. Callback events cannot re-enable a form while its request is pending.
- Verified tokens are passed as `captchaToken` to Supabase, which must enforce CAPTCHA server-side.
- Narrow cards use the compact widget. Widget theme follows the website theme. Google OAuth, signed-in redirects, account settings, and password-update pages keep their existing flows.
- Privacy policy includes Cloudflare disclosure.
- The production public site key in `signin.html` is deliberately blank. This is a staged integration, not active production protection. No secret key belongs in this repository.
- Local browser testing uses Cloudflare's documented dummy site key, injected by a temporary preview server only. It never changes live configuration or sends account requests.

## Safe activation order

1. Sign in to the Supabase dashboard and inspect Authentication > Rate Limits and Bot and Abuse Protection. Record actual values, including the shared email sending quota, recovery cooldown and per-IP limits. Verify custom SMTP provider sending limits and notification options separately.
2. In Cloudflare Turnstile, create a Managed widget for `bccsrtool.ca` and `www.bccsrtool.ca`. Do not add development hosts to the production allowlist. Cloudflare dummy keys are used for local testing instead.
3. Put only the PUBLIC site key into the `turnstile-site-key` meta tag in `signin.html`.
4. Deploy the website changes first. Check that widgets load on the live domain, including a narrow mobile screen. Keep Google OAuth available.
5. Enter the SECRET key directly into Supabase's CAPTCHA settings, select Turnstile and enable protection. Never paste the secret into chat or commit it to source control.
6. With a designated test account, verify missing/invalid tokens are rejected by Supabase and a real solved challenge allows sign-in and recovery. Do not disable production CAPTCHA to test a negative case. No high-volume testing is needed.
7. Verify token expiry, retries and fresh challenges after failures, plus signed-in redirect and Google sign-in.

This implementation limits form automation only when server-side enforcement is enabled. It does not prove immunity to a volumetric denial-of-service attack. Site-only button disabling or a site-only firewall does not stop direct requests to the Supabase endpoint.

## References

- https://supabase.com/docs/guides/auth/rate-limits
- https://supabase.com/docs/guides/auth/auth-captcha
- https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
- https://developers.cloudflare.com/turnstile/troubleshooting/testing/

Latest verification: all 134 automated tests passed; JavaScript syntax and diff whitespace checks passed. Local browser testing confirmed the public dummy widget enabled each email form after test verification and fit at a 320px viewport without page-wide overflow. These results do not verify production server enforcement.
