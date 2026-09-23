# Assistant V4 — Design QA

**final result: in progress**

## A00 home evidence

- Reference: `../doc/screens/A00.png` (860 × 2100 px).
- Browser: installed Windows Microsoft Edge, driven by Playwright 1.63.0.
- Context: mobile emulation with touch; 430 × 1050 CSS px at 2× for reference comparison, and 393 × 852 CSS px at 2× for the iPhone presentation.
- Data: isolated synthetic fixture in `work/edge-qa-a00-data` with two available suggestions and one 60% running task. Existing preview/application data was not modified.
- Latest page result: HTTP 200, screen `home`, no browser console or page errors. The mode-selection sheet was opened in the mobile context and also produced no browser errors.
- Captures: `work/edge-qa-captures/A00-final.png`, `work/edge-qa-captures/A00-final-side-by-side.png`, `work/edge-qa-captures/A00-iphone.png`, and `work/edge-qa-captures/mode-iphone.png`. Captures are intentionally Git-ignored.

## Findings and changes

- The earlier mismatch was not caused by the preview being stopped. The preview was responding, but the first comparison used stale QA state (one suggestion already prepared and no matching active task). A second issue was that the CSS build and service process were not restarted together after edits, so one capture still showed old server-generated copy. The isolated fixture and clean restart resolved both.
- Desktop-sized Edge contexts reserve layout width for a vertical scrollbar. The reusable runner now uses mobile emulation, preventing a false narrow-card/wrapping difference at phone-sized viewports.
- The A00 home now shows both reference suggestions and the running trip task. Due-time wording, source labels, task step/progress, and Shanghai-day labels are derived from current snapshot data. The task progress bar uses CSS rather than inline style, removing the prior CSP console error.
- The overall warm palette, header, tabs, cards, actions, composer, and bottom navigation align closely with A00. The first card remains somewhat taller because its explanatory copy wraps to an additional line at the live viewport. Its service note also intentionally says “本地准备服务” rather than claiming a cloud Agent or a two-minute runtime; this preview is using the local service.
- `A00-iphone.png` adds a reusable iPhone bezel and simulated status bar around a real 393 × 852 Edge mobile-context capture. This is a visual device mock, not a native iOS simulator capture.

## Remaining coverage

A00 home and the mode-selection overlay have been checked. A01–A10 and the other task/evidence/permission/result workflows still need dedicated same-state visual and interaction checks, so the full assistant design QA is not yet complete.
