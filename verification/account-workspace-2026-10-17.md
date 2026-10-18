# Account workspace verification — 2026-10-17

Implemented in account.html, auth.css, account-assessments.js, auth.js and the saved-assessment restoration metadata in data-utils.js. Shared asset versions updated in their HTML callers. Existing uncommitted source-audit changes retained.

- Saved assessments and Profile navigation; sidebar on desktop, two choices on mobile.
- Search assessment/site names; sort recently updated, oldest updated, or name (natural alphabetical ordering).
- Saved site, screening land use, APEC/sample counts and last-updated previews.
- Inline rename with trim/length validation, owner and revision filters, error handling, and preservation of unsaved browser edits.
- Existing named deletion confirmation and red deletion button retained.
- Results save status compares assessment inputs and title with the last successful save/reopen; local view preferences do not count as changed inputs.
- Library loads owner-filtered pages of 100 rather than silently omitting older records. It fetches payloads for previews; very large libraries will require more bandwidth.
- Profile hash survives refresh; authentication callback tokens are still removed.
- Sign-out note and actions sit on a readable surface above the background.

Validation: 94 Node tests passed, including temporary PostgreSQL RLS/revision tests (PGlite), rename failure/conflict tests, pagination/search/sort, and saved/unsaved status. JavaScript syntax checks and git diff --check passed.

Browser checks used a temporary localhost server with a fictional Supabase client, never production accounts. Desktop 1280px and mobile 390px: navigation, inline rename, search by site, name sorting, profile saving and Profile refresh verified. No horizontal overflow at 390px; no console warnings/errors in initial interaction checks. Screenshots contain fictional data.

The browser automation stalled at the native reopen confirmation. Reopening remains covered by unit tests; live manual reopening and two-account tests remain outstanding. The design scanner also reports incumbent theme warnings (near-threshold muted text contrast, font choice, glow and static leading diagnostics); no global theme changes were made.

No schema changes or deployment performed. Self-service account deletion and account-wide backup download remain later features. Remaining project tasks: conditional-standard inputs/resolution, deployment and live two-account verification, final PDF/Word visual checks, fresh database backup.
