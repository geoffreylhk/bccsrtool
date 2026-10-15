# Lab page simplification — October 12, 2026

- An empty assessment opens with Area of Potential Concern 1 and Sampling location 1. New areas and locations are numbered automatically within their respective parents.
- Names are clickable, keyboard-accessible headings. Click to edit inline; Enter or moving focus saves, Escape cancels. Empty/duplicate names cannot replace saved records.
- Removed always-visible APEC name/description and location name/type fields. Existing names, descriptions, types, IDs and measurements remain stored.
- New areas include their first sampling location. If the final area is deleted, the editor returns to a fresh numbered area.
- Changes limited to labdata.js, labdata.html, the associated styles and focused regression tests. Calculations and report logic were retained.
- All 44 automated tests passed. Browser checks confirmed initial open records, sequential numbering, area/location renaming and rename persistence after reload. No browser JavaScript errors observed. Screenshot: simple-lab-page.png.
- No publication or physical-device check was performed for this follow-up. Temporary preview servers were stopped.
