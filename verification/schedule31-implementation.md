# Schedule 3.1 screening-engine fixes

Historical stage record. The completed sample-workflow follow-up is documented in [sample-workflow-implementation.md](sample-workflow-implementation.md).

Completed locally: the regulatory accuracy and screening-engine stage of the redesign. The full site/APEC/location/sample workflow remains a later stage. Nothing was pushed or deployed.

## Changes

- Rebuilt `data.json` from the saved official Schedule 3.1 Parts 1, 2 and 3 PDFs using `verification/build-schedule31.py`: 40 matrix substances and 528 generic substance identities. Parts 2 and 3 each have 527 source rows; their differing coverage is flagged rather than filled with an assumed value.
- Removed the incorrectly interpreted groundwater thresholds. Screening and result entry now use soil concentrations. Previously saved groundwater entries remain stored and are excluded from screening.
- Centralized comparisons in `data-utils.js`. Mandatory soil intake and plant/invertebrate factors always apply. Six conditional factors have applicable, not applicable and not assessed settings. The engine selects the lowest resolved applicable standard and retains every individual comparison.
- Unknown applicability, blank standards and unsupported source conditions prevent an overall Pass. NS remains distinct from blank or unavailable data. A known exceedance remains visible even when other factors require review.
- Included generic standards from Parts 2 and 3, current/proposed land-use comparisons, unit conversion and source references. Source records retain page numbers, column or factor labels, conditions, document URLs, snapshot dates and PDF hashes.
- Updated results, CSV, Word, methodology text and the standalone Python lookup. Python calculations call the shared JavaScript engine. Improved Word table widths and repeated headers. Corrected ambiguous CSV matching for substances without a conventional CAS identifier.
- Refreshed cached land-use labels when assessment settings change. Existing authentication was retained.

## Verification

- All 25 authentication and screening tests passed. Coverage includes ecological controlling standards, conditional factors, generic standards, equality boundaries, invalid inputs, conversions, unresolved conditions, non-detect/reporting-limit calculations, recalculation, import ambiguity and retained legacy groundwater data.
- Checked the original 320 soil-intake fields against the earlier source audit. Checked non-merged generic cells against the source coverage audit. Merged source cells are extracted using PDF geometry; this is not an independent exhaustive manual validation of every cell.
- JavaScript syntax checks, local HTML script references and `git diff --check` passed.
- In the Codex browser at 390 by 844 pixels, entered anthracene at 3 mg/kg and antimony at 21 micrograms/g under residential low-density use. Anthracene exceeded the plant/invertebrate standard of 2.5 micrograms/g; antimony exceeded the Part 3 standard of 20 micrograms/g. Factor details and references displayed correctly, with no horizontal overflow or JavaScript errors.
- Browser CSV and Word downloads succeeded. CSV contained ten individual comparisons with soil units and provenance. The final Word layout was generated from the current export code with the same docx 8.5 library and rendered for visual inspection: two landscape pages, repeated headers and no clipped cells.
- Stopped the temporary local preview server on port 5518 after verification.

## Limits and next stage

- Complex pH, species, toxicity-equivalent, activity, partitioning, hardness, temperature and special-unit conditions require review. Footnoted substances are handled conservatively: their conditions are preserved and automatic numerical conclusions are blocked rather than inferred. Depth and multiple-land-use complications are also flagged.
- Non-detect/reporting-limit logic is tested in the shared engine, but a dedicated non-detect input interface is not yet implemented.
- Full site information, assessment-mode controls, optional proposed use, applicability justifications, APEC/location/sample hierarchy and associated multi-sample import/migration remain outside this first stage. No sample averaging was introduced.
- Physical phones, native Microsoft Word and the browser's native PDF-save flow were not tested. The rendered Word PDF verifies the Word layout, not the site's native PDF export.
- This is a screening tool. Unsupported conditions need professional interpretation before a regulatory conclusion can be made.
- Earlier audit CSVs and reports describe the original dataset and are historical evidence, not the schema of the rebuilt data.

## Evidence and sources

- Browser screenshot: `schedule31-results.jpg`.
- Tests: `../tests/screening.test.cjs` and `../tests/auth.test.cjs`.
- Saved source PDFs: `sources/schedule31-part1.pdf`, `sources/schedule31-part2.pdf`, `sources/schedule31-part3.pdf`.
- [Schedule 3.1 Part 1](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/133_2022_Sch%203.1-part1)
- [Schedule 3.1 Part 2](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/159_2025_Sch%203.1-part2)
- [Schedule 3.1 Part 3](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/133_2022_Sch%203.1-part3)

Source snapshot metadata and hashes are embedded in `data.json`; the consolidation snapshot checked was October 6, 2026.

## Factor controls and compact results follow-up

At the user's request, conditional factors now use three radio buttons styled as buttons: Applicable (green check), Not assessed (red cross), and Not applicable. Missing answers default to Not applicable in both the interface and shared engine; existing explicit saved choices are preserved. Result cards retain concentration, threshold, ratio and status but omit explanation blocks and source details. Export content remains unchanged. A Not applicable assumption excludes that pathway from comparison.

### Two-option factor controls

All eight factors are now shown with Applicable and Not assessed options. The mandatory rows use the source wording “Intake of contaminated soil” and “Toxicity to soil invertebrates and plants”; their Applicable selections are fixed and both controls are disabled. Conditional factors retain saved choices; an unanswered factor still defaults to Not applicable internally, following the user's earlier instruction. All 28 tests passed, including the two-option layout and mandatory locking check. This follow-up was checked through automated tests, not a fresh browser rendering check.

Next in the original prompt's priority order: complete site information (optional site name, optional proposed use, Current/Proposed/Both mode) and remaining factor justification fields, before introducing APECs, locations and individual samples. The user's later two-option and compact-result instructions override the original three-option and detailed-card presentation requirements.

### Selectable mandatory factors

The user clarified that both mandatory factor controls should be editable. They now default to Applicable and preserve a saved Not assessed choice. Not assessed blocks a confirmed Pass; it does not make the mandatory pathway inapplicable. All 29 tests passed. Browser rendering was not rechecked for this small follow-up.
