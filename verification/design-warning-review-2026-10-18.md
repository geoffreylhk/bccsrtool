# Review of six design warnings — October 18, 2026

Scope: review the six follow-up warnings against current source and the local Results preview. No website styling or behavior changed during this review. This is not a full accessibility or performance audit.

| Warning | Evidence | Decision |
| --- | --- | --- |
| Results tight line-height, reported as 0.14× | Browser body text: 16px font / 24px line height (1.5×). Desktop heading: 24px / 30px (1.25×). Mobile heading at 390px: 35.1px / 37.908px (1.08×). Footer brand is a single-line flex label, 1×. | The numerical report is inaccurate for body text. Mobile heading spacing is a minor polish opportunity if it wraps. Keep this warning unsuppressed for future review. |
| Results font popularity | Results inherits the shared Inter/system font stack. No dedicated Inter font import or bundled font was found. | Popularity is not a functional or accessibility defect; preserve the existing typography. Scoped font-warning exception recorded. |
| style.css font popularity | Same shared body declaration at line 70. | Same decision; duplicate warning. Scoped font-warning exception recorded. |
| style.css .why-note border | 3px green left border. Selector is not used in any current HTML file. | No visible issue. It can be deleted in a future CSS cleanup. Scoped border-warning exception recorded. |
| style.css .sample-apec border | 4px green left border; this distinguishes APEC group containers from nested samples on Lab Data. Neither flagged border selector exists on Results. | Functional grouping cue, not a readability bug. Preserve it. Scoped border-warning exception recorded. |
| style.css layout-property transition | Homepage .learn-more-link::before animates height for 250ms on hover. It is an absolutely positioned pseudo-element and does not move the document content. | Minor performance opportunity: use a transform if this effect is revised. No dropped-frame measurement was made. Leave warning unsuppressed. |

Results had no page-wide horizontal overflow at 1280px or 390px in the local preview. The previous muted-text contrast change remains in place.

Recommended priority: (1) loosen wrapped mobile heading spacing, (2) replace the small hover height animation with a transform during polish. No new font or border redesign is warranted solely to satisfy these warnings.

Only detector exceptions and this report were added during the review. No live-site verification or full screen-reader/performance testing was performed.

## Follow-up fixes

At the user's request, the two recommended changes are now implemented:
- Shared mobile page headings use 1.3 line-height instead of 1.08. Results at 390px measured 35.1px type / 45.63px line-height, with no page-wide overflow.
- Homepage information-link highlight uses scaleY from 0.08 to 1 with bottom transform origin, rather than transitioning height. Keyboard focus also expands the highlight. Browser measurements confirmed fixed 33.5938px pseudo-element height in both states, with transform as the only animated pseudo-element property.

Desktop/mobile browser verification and diff whitespace checks passed. Functional tests were not rerun for this CSS-only change; no JavaScript behavior was modified.
