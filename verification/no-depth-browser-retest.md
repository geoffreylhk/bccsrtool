# Browser rendering retest — October 13, 2026

Checked the current local code in the isolated Codex In-app Browser, using only fictional test data. No user Chrome tabs or native apps were controlled. No application code was changed.

- Desktop viewport: 1280 pixels wide. Mobile viewport: 390 × 844. Lab Data and Results fit the page width without page-level horizontal overflow.
- Area/sample hierarchy renders with the four requested columns: Contaminant, Detection, Concentration, Soil unit. No location controls, sample metadata fields, depth labels or depth uncertainty messages appeared.
- Imported four anthracene results across two areas, including one non-detect. Residential results were Pass, Exceeds, Pass and Exceeds; missing depth did not force an Inconclusive result.
- Non-detect entry identifies the shared concentration cell as a reporting limit, and the result displays < 1 mg/kg with the reporting-limit ratio.
- Mobile lab tables intentionally scroll within their containers. Keyboard navigation reached the soil-unit selector and moved the table horizontally (423-pixel content inside a 299-pixel container). The page itself remained 390 pixels wide. The sample-count text wraps tightly in the mobile header, but controls and input fields remain accessible.
- Reload retained four samples and four entered results. Final browser error logs were empty on Lab Data and Results.
- Visually inspected desktop/mobile screenshots. Evidence: no-depth-lab-desktop.png, no-depth-lab-mobile.png, no-depth-lab-mobile-units.png, no-depth-results-desktop.png, no-depth-results-mobile.png.

Temporary viewport settings were reset and the local preview server stopped. No deployment, physical-device testing or native PDF/Word testing was performed in this rendering retest.
