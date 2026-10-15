# Private saved assessments — October 14, 2026

## Implemented locally

- Results: named Save to account, Save changes to account, and Save as a separate copy. Guest browser use remains available. Saving is explicit; editing does not silently upload or overwrite account saves.
- Account: recent private saves with View results, Edit values, Delete saved assessment and Refresh. Safe text rendering for titles, saved timestamps and accessible buttons. Account navigation available throughout the workflow.
- Reopening restores land use, factors, contaminants, areas, samples, values, units and non-detect reporting limits. Existing shared screening logic recalculates results; saved inputs are not immutable historical reports.
- Before opening, the user confirms replacement of the working browser assessment, and a local recovery copy is kept under bcCsrAssessmentBeforeOpen. Starting a new assessment or clearing site storage removes the local recovery copy. It is not uploaded.
- Account record ID/owner/revision stays in local working state; it is excluded from the uploaded snapshot. Signed-in owner checked before operations and database owner policies apply independently. Account changes clear the displayed list/save form.
- Revision checks prevent stale saves/deletes after another device changes a record. Reopen to resolve conflicts or save a separate copy. Titles limited to 100 characters, uploads to 250 KB, newest 100 saves listed. No original laboratory documents uploaded.
- Privacy text explains cloud storage, retention, deletion, provider processing and remaining shared-browser local data.

## Checks completed

65 tests passed with zero skips, including real PostgreSQL SQL execution in a temporary PGlite runtime. Database tests cover anonymous denial, own-row CRUD, other-user denial, immutable owner/revision columns, invalid payload/title checks, optimistic revision changes, and cascading account deletion. Runtime installed only under /private/tmp; no repository dependency added.

Command to rerun the complete test suite while that temporary runtime exists:

```sh
BCCSR_PGLITE_PATH=/private/tmp/bccsr-db-verify/node_modules/@electric-sql/pglite node --test tests/*.test.cjs
```

Without that environment variable, normal Node tests run but the database-runtime test is explicitly skipped.

Browser checks used an isolated Codex in-app tab with a fictional local authentication/database fixture, never the user's browser or production records. Save → account list → Edit values → concentration change from 0.05 to 5 → Results → Save changes → View results restored 5. Signed-out production-code preview showed the sign-in prompt. Account mobile layout at 390 px has no document overflow; desktop and mobile screenshots are saved alongside this document.

The test fixture and its mocked Supabase client are outside the repository under /private/tmp/bccsr-save-preview. They must never be deployed. No hosted schema changes, real cloud assessment saves, cross-device cloud tests or deployment have been performed yet.

## Enable in Supabase next

1. Open this project's Supabase SQL Editor.
2. Open supabase/saved-assessments.sql from the repository and copy the whole file into a new query.
3. Run it once. It creates only public.saved_assessments plus its index, owner policies and revision trigger, in a transaction. It does not alter public.profiles or existing authentication users. The script deliberately fails if the table already exists instead of replacing data/policies.
4. Confirm successful execution. Check Table Editor: saved_assessments exists, RLS enabled, four own-row policies. It is initially empty.
5. From the local website signed into one account, save a fictional assessment from Results and check Account → Saved assessments → Edit values. Change a value and save changes. Sign out and use a second account: the first account's saves must not appear. On another browser/device with the same account, check the record loads after the website has been deployed there.
6. Take a fresh database backup after adding the table and saving real records; the old backup predates saved assessments.

Public launch remains on hold until hosted storage and real two-account isolation are verified. Google sign-in's existing local sign-in/profile/sign-out checks were reported passed by the user before this feature.

Update: the user reported the hosted saved_assessments table was created. See account-isolation-fix.md for the subsequent fix to shared browser progress; sign-out now clears the working browser assessment and recovery copy while retaining account saves.

## References

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/reference/javascript/auth-getuser
- https://supabase.com/docs/reference/javascript/update
