# Export process checks — October 13, 2026

Used the isolated Codex In-app Browser and fictional four-sample assessment. No user Chrome tabs or native applications were controlled.

## Word download

Downloaded the actual website report through Export Word. Rendered the downloaded DOCX with the bundled document renderer and visually inspected both pages. Confirmed all nine table rows (one header plus eight factor comparisons), repeated headers, landscape layout, two exceedances, non-detect < 1 and no depth labels.

The first downloaded report exposed leftover location labels. Removed that location element from Word sample identity text in results.js, added a regression assertion and refreshed its results.html cache version. Downloaded the corrected report again and inspected both final pages. The final report contains area/sample labels only. Evidence: tested-word-export.png. All 50 automated tests passed.

## PDF print flow

Selected the Exceedances filter, then invoked Export PDF. The click timed out while the native print interaction was pending, but the document visibly changed to All results with all four factor tables expanded, confirming the print preparation executed. Sent Escape through the isolated browser to cancel; the screen returned to Exceedances with collapsed tables. No browser errors were reported.

Actual Save as PDF and the saved browser-print PDF layout remain unverified because the native save dialog is outside the available browser interface. The Word renderer's PDF is not a test of native browser PDF export.

## Mobile interaction

At 390 × 844, changed a measured value to 1.2, navigated with the keyboard, reloaded and confirmed persistence. Opened results and filtered to Exceedances; the expected two samples remained. Page width equalled 390 with no page-level horizontal overflow and no browser errors. Evidence: export-check-mobile.png. Earlier rendering checks also covered internal horizontal scrolling to the soil-unit selector.

## Unavailable device checks

No connected Word document-control sessions were available. Native Microsoft Word and a physical phone were not tested. These checks require the user's device/application; the report has only been downloaded and rendered with the bundled renderer.

Viewport settings were reset, the temporary tab closed and the preview server stopped. Nothing was deployed.
