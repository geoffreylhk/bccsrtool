# Security and cost controls — 24 October 2026

## Applied to the hosted Supabase project

- Project: `gsbemjemdiofppgjxiyi`.
- Migration: `assessment_storage_and_write_limits`; reproducible SQL in `supabase/assessment-limits.sql`.
- Maximum 100 saved assessments per account. Existing records are preserved; updates and deletes remain possible at the count limit.
- Maximum 20 successful inserts/updates (including renames) per account per 60-second window. Deletes remain available. Failed transactions roll back counter changes.
- Private counter rows serialize concurrent writes for the same owner. Counters cannot be read, changed or reset by browser roles and are removed when their auth user is deleted.
- Owner RLS and existing 256 KiB payload constraint remain in force. These controls apply to direct Data API writes, not just the website UI.
- No Storage buckets existed during inspection. The publishable browser key is intended to be public; it does not grant unrestricted access to private records.

Local frontend changes give specific quota/rate error messages without discarding the working assessment. Full-payload account requests now fetch 10 records per page instead of 100; search and exports still retrieve all pages. This reduces individual response size, not total data transferred or malicious direct API reads. Publish the frontend changes through the normal GitHub Pages workflow.

## Dashboard actions for the owner

1. **Keep Supabase on Free while usage permits.** The organization was verified as Free. Supabase states Free usage is not charged. Before any Pro upgrade, review and enable its Spend Cap, and check excluded items such as compute and add-ons. This is not a universal dollar budget. Check any separate email-provider subscription too.
2. **Verify server-side CAPTCHA.** Open the project dashboard → Authentication → Bot and Abuse Protection (the navigation wording can vary). Enable CAPTCHA, select Cloudflare Turnstile, and enter the matching Turnstile **secret directly in Supabase**. Never put it in the repository or chat. The frontend public site key is already configured. Ensure the widget allows `bccsrtool.ca` and `www.bccsrtool.ca` and works on the deployed sign-in page before enabling enforcement. Complete a real sign-in/sign-up/recovery check; requests with missing or invalid CAPTCHA must fail. The owner must complete any challenge. Check Google sign-in separately.
3. **Review Authentication → Rate Limits and SMTP.** Keep conservative limits on sign-up, password recovery and email sending; do not raise them merely to bypass a failed test. Disable anonymous sign-ins if unused. Identify the SMTP provider and keep its free/hard sending limit or paid overage cap enabled. Supabase's cap does not control another provider's bill.
4. **Enable website proxy protection in Cloudflare.** If the domain is not already a Cloudflare zone, add it using the Free plan, preserve the existing DNS records, and follow its nameserver instructions. Proxy the website's apex and `www` A/AAAA/CNAME records (orange cloud); leave mail records alone. Keep valid origin HTTPS and use Full (strict) TLS. Verify apex/www, sign-in, OAuth redirects and email after DNS changes. The previous inspection found GitHub Pages responses without Cloudflare proxying. Turnstile alone does not proxy the website.

## Boundaries and verification

- Website Cloudflare proxying does **not** cover direct requests to the project's `supabase.co` API. The per-account limiter is not a global/IP limiter or a DDoS firewall; rejected requests still reach the database. Many accounts and repeated reads remain abuse paths. Avoid adding a paid proxy/server solely on the assumption it guarantees a hard spending limit.
- RLS prevents one account reading another's rows; hiding/rotating a publishable key is not a substitute. Future private uploads require private buckets and owner-scoped Storage policies.
- 162 local tests passed with the temporary PostgreSQL-compatible PGlite runtime, including owner isolation, rate recovery, capacity, cascade cleanup and preservation of local edits. Command: `BCCSR_PGLITE_PATH=/private/tmp/bccsr-db-verify/node_modules/@electric-sql/pglite/dist/index.cjs node --test tests/*.test.cjs`.
- Live database test: an authenticated owner could update their record 20 times; write 21 failed with `PT429`; anonymous reads failed. The entire test transaction was rolled back. Post-test checks: six original assessments, zero persisted test counters, no client schema usage/function execution privilege.
- Post-change advisor: an informational [RLS enabled/no policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) for the private counter is intentional default-deny protection. Existing [account-deletion definer warning](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) remains: this narrowly scoped owner/session/email-checked operation intentionally requires elevated privileges. [Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) is still disabled; enable if available on the existing plan, without upgrading solely for this check.
- Not verified: full two-browser account isolation, concurrent load, production frontend deployment, server CAPTCHA configuration, actual SMTP billing/caps, or Cloudflare DNS changes. No attack/load test, account creation, email send, subscription change, DNS change or key rotation was performed.

Sources: [Supabase cost control](https://supabase.com/docs/guides/platform/cost-control), [CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha), [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits), [API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Cloudflare proxy status](https://developers.cloudflare.com/dns/proxy-status/).
