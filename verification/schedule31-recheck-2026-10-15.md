# Schedule 3.1 source and factor recheck — 15 October 2026

## Findings

- The current BC Laws consolidation is dated 6 October 2026. Fresh downloads of Parts 1, 2 and 3 have exactly the same SHA-256 hashes as the project's source PDFs; no numerical source update was found.
- Independently re-extracted all 10,992 stored land-use cells using PDF table/cell boundaries: 2,560 Part 1 cells, 4,216 Part 2 cells and 4,216 Part 3 cells. All raw values match, including blanks, NS and conditional notation. Verified coverage of all 40 matrix tables and all 527 substance rows in each generic part. Full results: `schedule31-cell-recheck.csv`.
- A separate comparison with the pre-fix dataset confirms **zero numeric/raw-cell changes**. The defect was the assignment of whole-matrix notes to every factor. The importer now reads the actual Note column for each factor, retains heading-level analytical conditions, and stores the referenced source notes. A pH definition alone does not disqualify unrelated numerical rows. Conditional pH bands remain unresolved.

## Benzene: official Part 1, Matrix 4, PDF page 4

| Factor | Residential low density | Residential high density |
| --- | ---: | ---: |
| Intake of contaminated soil | 150 | 350 |
| Toxicity to soil invertebrates and plants | 100 | 250 |
| Groundwater used for drinking water | 0.035 | 0.035 |
| Groundwater flow to surface water used by aquatic life — freshwater | 2.5 | 2.5 |
| Groundwater flow to surface water used by aquatic life — marine | 6.5 | 6.5 |

Values are soil concentrations in µg/g. With the two mandatory factors applicable and conditional water factors unanswered/excluded under the user's existing rules, the resolved RLLD threshold is 100, controlled by ecological protection. With drinking-water protection applicable, it is 0.035. The quoted set 1000/70/0.04/10/2.5 does not match benzene Matrix 4 in this consolidation. No substitution of those numbers was made.

## Lead regression: Part 1, Matrix 18, PDF pages 22–23

Lead's RLLD intake cell is 120 µg/g and its ecological cell is 550 µg/g. Those rows have no pH/hardness note markers. Previously, the importer copied the pH/hardness notes onto both, causing all numerical thresholds to become unresolved. Correctly scoped notes restore the resolved 120 intake threshold when conditional factors are excluded. Selecting the pH-dependent drinking/aquatic factors still prevents a confirmed pass until the conditions are resolved. This is not blanket approval of all lead scenarios.

The same scoping correction covers notes on other matrices, including PFOS activity notes on drinking/aquatic rows. Matrix-wide analytical requirements for PCB sums, DDT sums and dioxin/furan toxicity equivalents remain flagged. Chromium species notes, conditional pH bands, special units, blank cells and not-assessed applicability are not silently resolved.

## Results presentation

Both layouts display the controlling factor. When an applicable factor is unresolved, the caption says **Lowest resolved factor** instead. A closed-by-default **Standards by factor** disclosure lists every factor/generic standard, raw source value, applicability/status, and an official PDF page link. Names of contaminants remain plain text. Slim rows place provenance below the numeric row, allowing it to use the full mobile width. CSV/Word source provenance is retained, with note references added; print opens factor disclosures and restores the screen filter/layout afterward.

## Verification and limits

- 88 automated tests pass, including new benzene/lead cases, note scoping, both result layouts, existing CSV/Word/print checks, account isolation and database policy tests.
- Desktop matrix and mobile slim-row rendering checked in an isolated browser; no page-wide overflow or browser console errors. Saved screenshots: `verified-factor-sources-desktop.png` and `verified-factor-sources-mobile.png`.
- The reusable `verify-source-cells.py` audits source hashes, full row coverage, every stored cell, and Part 1 note-column references. It does not use the importer's extraction functions and never changes the dataset.
- This verifies source transcription and fixes a specific interpretation defect; it does not resolve pH/hardness/species/activity conditions or certify a site's regulatory compliance. Factor selection still follows the user's prior instruction that unanswered conditional factors are not applicable; this assumption is not a verified Protocol 21 water-use determination.
- Changes are local. No push, deployment, live-account changes or live-data edits were performed. Previously saved results recalculate against the current dataset when reopened.

## Official sources

- Consolidation: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/375_96_00
- Part 1: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/133_2022_Sch%203.1-part1
- Part 2: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/159_2025_Sch%203.1-part2
- Part 3: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/133_2022_Sch%203.1-part3
