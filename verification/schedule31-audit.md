# Schedule 3.1 audit — 11 October 2026

Status: audit complete for the existing application's data and calculation paths. No production code, numerical dataset, saved assessment, or live deployment changed in this step. The corrected screening engine is not implemented yet.

## Scope and evidence

Read data.json, data-utils.js, results.js, query.py, the assessment/contaminant/laboratory interfaces, About/methodology content, and existing tests. Retrieved fresh official Schedule 3.1 Parts 1, 2 and 3 and Protocol 21. The consolidation is current to 6 October 2026; its overall amendment date does not establish the amendment date of every individual table.

Re-extracted and compared all 640 existing threshold fields (40 substances × eight land uses × two stored fields). All 38 existing numeric CAS identifiers match Part 1 matrix headings. DDT and nonylphenol/ethoxylates have no applicable CAS number; storing `NS` as their CAS confuses identity with the meaning “No Standard.” All 40 Part 1 matrices are represented, but most factor rows are missing.

The existing threshold-source-check.csv remains consistent with the fresh comparison: all 320 soil fields match the soil-intake row or its special notation. This is transcription verification for one row, not verification of the governing site standard. The other 320 fields cannot be used as groundwater analytical standards. schedule31-substance-audit.csv records each matrix, source pages, identity check and conditions needing resolution.

Extracted the generic tables for a coverage inventory in schedule31-generic-coverage.csv: 527 substance rows per part, 1,054 part-specific records. These records are absent from the current application. This CSV is an audit inventory, not an approved engine dataset: merged cells, footnote markers and exceptions require resolution before ingestion. Spot checks of acenaphthene, antimony, asbestos and vinyl chloride agree with source text in both parts. Every generic numeric cell was not independently checked.

## Findings, in implementation priority order

1. **Wrong sample medium.** results.js evaluates `gwConc` in µg/L against Part 1 soil values in µg/g. data-utils.js, labdata.js, CSV/Word reports, About and query.py perpetuate this interpretation. A unit-label change cannot correct a dimensional mismatch. Retain old water records during migration, but exclude them from Schedule 3.1 screening.

2. **Mandatory ecological factor omitted.** Soil comparisons use only `thresholds[landUse].soil`, the intake row. No factor collection or minimum-selection engine exists. The two mandatory factors and applicable conditional factors must be evaluated individually before selecting the controlling numerical value. Unknown applicability must remain an uncertainty.

3. **No Part 2/3 coverage.** The current 40-substance dataset is entirely Part 1. Generic human-health and ecological standards need their own source records and evaluation rules, including special units and non-numerical entries. They must not be assigned fictitious matrix factors.

4. **Chemical conditions lost.** The current schema has only `soil` and `gw`, with no structured species, analytical basis, applicability, receptor conditions, footnotes or effective-source record. Existing pH strings preserve no bands. DDT is a specified sum; PCB and dioxin/furan results require defined analytical bases. Chromium requires species distinctions. PFOS and sulfolane have activity-related conditions. Hardness, receiving environment, partition coefficient and temperature can affect particular factors. These conditions cannot be inferred from the existing numeric inputs.

5. **Land-use and uncertainty handling incomplete.** Both land uses are collected, but results select proposed use only. No sample depth, multiple-use determination or Protocol 21 water-use evidence is collected. Missing factor rows and unresolved substance conditions do not prevent a numeric soil comparison from appearing green. Existing handling of nonnumeric stored values avoids division by them, but is not a complete uncertainty policy.

6. **Misleading descriptions and provenance.** About describes groundwater standards and an incorrect benzene water example. Reports identify a JSON field rather than a regulatory table/row/column/footnote. `unrestricted` is not a faithful interpretation of the source notation. Query.py repeats the same incorrect water comparisons. These connected outputs must change together with the engine.

## Reproduced calculation defects

Ran the application's current getRowsForProfile and getMatrixResult using the existing test harness, without changing browser storage:

| Hypothetical input, RLLD | Current soil result | Verified omitted mandatory factor |
| --- | --- | --- |
| Anthracene, 3 mg/kg | Below the intake value of 10,000 µg/g | Exceeds plant/invertebrate value of 2.5 µg/g |
| Benzene, 120 µg/g | Below the intake value of 150 µg/g | Exceeds plant/invertebrate value of 100 µg/g |

These demonstrate individual factor exceedances, not a complete site determination. Benzene has other conditional factors. A separate 0.1 µg/L benzene input was also evaluated against the soil drinking-water-protection value of 0.035, reproducing the dimensional error.

Fresh source-row comparisons additionally flag the same 24 `gw` provenance anomalies: eight chromium species-dependent entries labelled pH-dependent, eight PCE entries from the aquatic-protection soil row, and eight TCE entries inconsistent with the drinking-water-protection row. TCE agricultural 1.5 also differs from 15 in the ecological row it otherwise resembles; industrial is missing. A blank source cell is not automatically equivalent to NS or zero.

## Required engine contract

- Soil concentrations only; mg/kg and µg/g are equivalent. Preserve unit conversion validation and precision.
- Distinguish Part 1 factors from Part 2/3 generic records; preserve source notation and units.
- Evaluate both mandatory factors, applicable conditional factors and each requested land-use scenario. Return individual comparisons and the lowest resolved applicable number, including ties.
- A numerical exceedance remains visible even when another factor is unresolved. A below-limit result cannot become an overall pass while applicability or required conditions are unknown.
- Treat NS, blanks, unavailable records and unresolved conditions distinctly. Do not substitute zero or assume that missing data means a factor is inapplicable.
- Require analytical basis and substance/site conditions where needed. Keep non-detects separate from zero and compare reporting limits conservatively.
- Record source URL, schedule/part, matrix or generic substance row, source column, units, footnotes, source version and retrieval date alongside every standard.

## Reuse and implementation boundaries

Reuse data-utils.js storage/validation, current static pages/styles, contaminant lookup, strict CSV parsing and report layout. Keep auth unchanged. Introduce the factor-aware regulatory records and shared evaluation first; then connect results, threshold views, exports, query.py and methodology descriptions. Site/factor controls and sample hierarchy belong to the subsequent workflow steps. Existing saved water measurements must not be silently reinterpreted as soil.

## Validation and limitations

All 17 existing automated tests passed. They cover current input validation, conversions, persistence, imports, auth and export content/wiring, but some assert the incorrect groundwater interpretation. They must be revised when that behavior changes; passing them does not prove regulatory accuracy.

This step did not retest the live website, mobile layout or actual PDF/Word downloads. It did not implement the corrected engine or independently validate every absent generic value and environmental-factor cell. No Schedule 3.2 data was imported. Existing screening outputs retain the defects above.

## Official sources and downloaded file identities

- [Schedule 3.1 index and consolidation](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/375_96_07)
- [Part 1: matrix soil standards](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/133_2022_Sch%203.1-part1), 49 pages. SHA-256: `b92fd71c8f137fad52ded00b5186901e8f99a3f711fb613396bd6bf2bae8886c`.
- [Part 2: generic human-health soil standards](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/159_2025_Sch%203.1-part2), 21 pages. SHA-256: `f98389bf8463197d77746aeb063695178842cf53afda2682943cf452c2fb5663`.
- [Part 3: generic ecological soil standards](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/133_2022_Sch%203.1-part3), 20 pages. SHA-256: `2b084f94bcf69245cf19a47f618b84b3d482c6ea12a2ba0cabf399e408bf6465`.
- [BC selecting numerical standards guidance](https://www2.gov.bc.ca/gov/content/environment/air-land-water/site-remediation/investigate-a-site/standards-for-contaminated-sites/selecting-numerical-standards)
- [Protocol 21: Water Use Determination](https://www2.gov.bc.ca/assets/gov/environment/air-land-water/site-remediation/docs/protocols/protocol_21.pdf), downloaded successfully after the web reader failed. Version 2.0, effective 1 November 2017. Review covered its current/future water-use structure; no automated applicability determination was implemented.
