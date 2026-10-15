# Default samples and factor simplification — October 14, 2026

- Removed Notes / justification controls and their event handler from all eight factors. Existing stored justifications are retained as legacy assessment metadata; no saved assessment values were deleted.
- newApec now starts with an independent Sample 1 containing blank rows for selected contaminants. Adding another sample uses the same sample constructor and continues numbering within its area.
- On opening Lab Data, any saved empty area gets one default sample. Existing samples and values are preserved, and repeated loads do not add duplicates. Deleting a sample still works during editing.

49 screening/workflow regression tests passed, including new checks for default samples, independent blank concentrations, empty legacy areas, reload idempotence and removal of factor-note controls. Syntax and whitespace checks passed.

Isolated browser verification: selected Benzene, entered Lab Data and observed Area 1/Sample 1 already open; entered 5; clicked Add area and observed Area 2/Sample 1 with a blank Benzene value. Reload retained exactly two samples with values [5, blank]. Assessment DOM contained eight factor groups and zero notes controls. Screenshots: default-area-samples.png and factors-without-notes.png. Temporary browser tab and server stopped. No deployment or hosted data changes performed.
