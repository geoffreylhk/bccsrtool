# Working-assessment account isolation — October 14, 2026

## Confirmed cause

Continue my assessment read shared bcCsrToolState browser storage. Signing out hid the account list but left the working assessment, resume flag, legacy storage and recovery copies. Thus another signed-in account could continue the first account's local work, even with correct database row-level security.

## Fix

- Working-assessment ownership is tracked locally by bcCsrWorkingAccount. Account switches and signed-out sessions clear the current working state, legacy copies, resume flags and recovery backups. Supabase saves are never deleted by this operation.
- A shared assessment-session module listens to Supabase authentication events on auth and assessment pages. Other open tabs reload on local ownership changes or clearing the state so stale inputs cannot restore the former user's assessment.
- Successful sign-out explicitly clears browser progress before navigating to sign-in. A confirmation explains loss of unsaved working edits; cancelling or failed sign-out retains them.
- Email/password sign-in and account-save operations also check local ownership. Same-account sign-in and token refresh leave the working assessment intact.
- Guest work can be taken into the first account after the guest session is established. Unattributed old working data is cleared on first signed-in initialization instead of being assigned to an unknown account. Save important local work before reloading this update; existing cloud saves remain.
- A late account-list response rechecks the user before displaying records. A late save response cannot attach the first user's record ID to a different account's working assessment.
- Account/sign-in/privacy copy now explains explicit account saving and clearing local work on sign-out. No SQL/schema changes or hosted modifications are needed for this fix.

## Verification

73 Node tests passed with PostgreSQL-runtime tests included. Added account-switch, guest-to-account, same-account refresh, legacy ownership, multiple-tab storage, account-page refresh, successful sign-out, cancelled sign-out and failed sign-out checks. Existing sample, screening, account-save, Google callback and database access tests remain passing.

In an isolated Codex browser using fictional local accounts: opened the first account's Demo site assessment, observed Continue my assessment on a second open home tab, signed out, observed that resume disappeared in that second tab, signed into a different account, confirmed it had no account saves and no Continue button, then signed back into the first account and confirmed Demo site remained saved. The screenshot is account-isolation-second-account.png. No real credentials or production records were used. Temporary preview servers/tabs were stopped after testing.

Real-account local retest and live deployment remain pending. Save working changes to the account before signing out; only saved account assessments survive the boundary.

Reference: https://supabase.com/docs/reference/javascript/auth-onauthstatechange
