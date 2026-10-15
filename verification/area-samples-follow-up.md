# Areas and samples simplification — October 13, 2026

Removed location controls and the sample ID/depth/date inputs from Lab Data. Sample cards now sit directly beneath their area and contain Contaminant, Detection, Concentration and Soil unit. New samples are automatically numbered across their area.

The separate reporting-limit column is removed. For Non-detect, the single measurement cell accepts a positive lab reporting limit and identifies its meaning. Switching a detected measurement to Non-detect does not silently reuse its old concentration as a limit; the change remains unsaved until a valid limit is entered.

Old location associations and sample metadata remain stored for compatibility. All samples from existing locations render in their area; results headings omit location names. CSV import/template supports area/sample rows without location columns, using the value cell as the reporting limit for non-detects. Legacy CSV/report metadata remains supported.

All 47 tests passed, including legacy sample preservation, the four-column UI, detected/ND edits, rejection of invalid ND limits, and area-only CSV imports. JavaScript syntax and whitespace checks passed. No browser rendering check was performed for this follow-up: the available tools did not expose the prior browser interface, and the local preview server could not bind its port. Nothing was published.

The screening engine's depth uncertainty checks remain unchanged. New samples have unknown depth; this can yield Inconclusive even where a numerical comparison is below its resolved standard. No depth was invented to force a Pass.
