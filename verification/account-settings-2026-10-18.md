# Account settings and self-service data — 2026-10-18

Implemented:
- Settings saves a default chemical sort (category, order added, alphabetically) in the owner's profile. Auth initialization syncs it to the browser; new assessments inherit it. Per-assessment overrides remain until the saved default changes. Changing/signing out of an account removes its cached default.
- Saved assessments offers a CSV download of the authenticated user's account details, complete profile/preferences, and all saved assessments, paginated beyond 100 saves. It excludes passwords, access/refresh tokens and unsaved browser work. The file contains private assessment inputs and should be stored privately.
- Settings alone contains Sign out.
- Delete account has two website dialogs: “Are you sure?” with red Yes and No; then an exact typed current sign-in email address. The button stays disabled for partial, different-case or whitespace-mismatched input. The server independently compares the current Auth email and validates caller/session ownership.

Database:
- The approved Supabase migration `account_preferences_and_self_deletion` is installed. Source is supabase/account-settings.sql followed by supabase/account-deletion-email.sql. Existing account data was retained; no live account was deleted for testing.
- chemical_sort has an allow-list check and category default. Existing owner RLS continues to protect profiles.
- delete_own_account(text) accepts no target user ID. It validates auth.uid() and the JWT's live session, checks the current Auth email, revokes that owner's refresh sessions and deletes only that owner's Auth row in one transaction. Existing foreign-key cascades remove their profile, saved assessments and linked refresh/session data. Errors roll the transaction back.
- Anonymous execution is denied. SECURITY DEFINER and an empty search_path are intentional for this protected self-service Auth operation. Auth schema is not exposed to browser queries and no service-role/secret key was introduced.
- Database setup was initially declined, then successfully applied after the user requested approval again.

Verification:
- 110 tests pass: local PostgreSQL owner/RLS/email/session/cascade tests, rollback on blocked deletion, settings validation/default inheritance, account-change guards, full export pagination, and absence of session tokens in exported data.
- Desktop and 390px phone preview used only fictional data. Sorting saved successfully; both deletion dialogs worked; actual typing enabled Delete only for the exact name. Cancellation left the account intact. No live deletion was attempted.
- Downloaded bccsrtool-account-data-2026-10-18.json inspected: fictional preview-owner, alpha preference, two complete assessments, no account access token. Browser automation's fill method did not emit the input event; actual keyboard typing verified the real interaction.
- Screenshots: settings-preferences-desktop.png and settings-delete-confirmation.png. No browser errors/warnings appeared during the preview.

Advisories and limits:
- Supabase reports the intentionally authenticated SECURITY DEFINER function: [advisory explanation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Its caller/session/email checks and permission restrictions are tested.
- Existing [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remains disabled; this work did not alter password policy.
- Supabase access JWTs can remain cryptographically valid until expiry. Deleted users have no remaining profile/assessment rows, inserts require the now-missing Auth FK, and the deletion RPC additionally requires a live session. Other devices clear local work when their SDK reports sign-out/refresh failure, not instantly while offline.
- Provider backups and logs follow provider retention. The feature does not claim to erase existing backups or files already downloaded to users' devices.
- Website files are local and still need deployment. Production two-account end-to-end testing remains outstanding.

Email confirmation follow-up: the user selected sign-in email instead of display name. Migration account_deletion_email_confirmation applied successfully; server metadata confirms the function reads Auth email and ignores display_name. Selected deletion/auth/dialog tests pass. The dialog labels the field Email address and uses an email-friendly keyboard.
