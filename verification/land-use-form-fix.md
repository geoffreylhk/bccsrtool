# Single-choice land-use form — October 14, 2026

- Removed Both land uses from the form and the Multiple land uses checkbox/explanation.
- Both Current and Proposed dropdowns stay visible and editable. Only the use selected under Screen against is required and used for screening. Proposed no longer says optional. Both entered values are preserved.
- Shared validation now allows Proposed with no Current value. Existing scenario evaluation remains the same and screens only Proposed in proposed mode, only Current in current mode. Legacy Both records remain readable; reopening them in the site editor selects Current, and the obsolete multiple-use flag is cleared when using that editor.
- Updated script/storage/style cache versions so the form behavior loads consistently throughout the workflow.

74 tests passed with the temporary PostgreSQL runtime enabled, including a new form interaction regression and proposed-only validation/scenario checks. Syntax and whitespace checks passed.

Isolated browser checks: only two screening choices; choosing Proposed hides Current and enables Next after selecting Residential Low Density while Current remains empty; Next reaches Contaminants; returning retains Proposed and its selection. Switching to Current disables Next until Current is selected; selecting Industrial enables it and hides Proposed. Mobile at 390 px had no document overflow. Screenshots: land-use-proposed.png and land-use-mobile.png. Temporary browser tab and preview server stopped.

No standards values or database schema were changed. Live deployment and real-account retesting remain pending.

Follow-up correction: restored both visible dropdowns at the user's request. Updated the form regression to verify both stay enabled and visible while required validation follows Screen against.
