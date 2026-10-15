# Depth removed — October 13, 2026

At the user's request, sample depth is no longer collected, validated, imported, displayed, exported or used as a screening uncertainty. Schema version 5 removes depthFrom/depthTo from active saved samples while preserving record relationships, measurements and the original migration backup. Old CSV depth columns are ignored.

Removed the missing-depth and greater-than-3-m checks, result depth labels, CSV depth columns and Word sample-depth text. Updated methodology/tooltips/privacy text and asset versions. Source documents and regulatory conditions are retained; other uncertainties continue to prevent a Pass.

All 50 tests passed. New regressions verify depth-free migration without measurement loss, depth-free Pass/Exceeds/Inconclusive behavior and depth-free result/CSV output. JavaScript syntax and whitespace checks passed. Native Word/PDF and browser rendering were not retested for this follow-up. No deployment was performed.

This supersedes the missing-depth limitation in area-samples-follow-up.md. The tool now performs screening without sample-depth adjustments and does not assess depth-specific regulatory exceptions.
