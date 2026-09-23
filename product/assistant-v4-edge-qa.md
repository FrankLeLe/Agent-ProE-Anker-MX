# Assistant V4: reusable Windows Edge QA

The browser runner is installed only for this Windows user at
`C:\Users\weiyu\AppData\Local\MixtureX\edge-qa`. It contains the verified
portable Node.js 24.21.0 executable and Playwright 1.63.0. It uses the
already-installed Microsoft Edge (`msedge` channel), not a downloaded Chromium
browser. No system PATH or global Node installation was changed.

The matching Linux Node 24 executable for this WSL preview is installed in
`work/edge-qa-runtime/node` and ignored by Git. The normal WSL `node` remains
unchanged.

From this repository in WSL:

1. Start the loopback preview with a dedicated QA state directory:
   `npm run qa:edge:preview` (or `bash scripts/edge-qa-preview.sh 4173`).
   This uses the pinned Node 24 runtime and rebuilds the H5 assets first.
   The default `work/h5-data` is user/application data and must not be used for
   QA fixtures. The server should stay on `127.0.0.1`.
2. In another shell run `npm run qa:edge -- assistant A00` (or
   `bash scripts/edge-qa.sh assistant A00`). This opens Edge in a mobile/touch
   context and captures a 430×1050 CSS viewport at 2× pixel density, plus a JSON
   result with HTTP status, screen ID and browser-console errors. Both files go
   to `work/edge-qa-captures/`.

For an interaction state, pass a `data-action` value as the third argument,
for example `bash scripts/edge-qa.sh assistant mode-sheet assistant-open-mode-sheet`.
Set `EDGE_QA_URL` to target a different loopback preview port. The wrapper
checks preview availability before launching Edge. It does not write to or
clean the application's data directory.
If port 4173 already has a preview, reuse it for capture or launch the isolated
preview on 4174 with `npm run qa:edge:preview -- 4174` and capture with
`EDGE_QA_URL=http://localhost:4174/ npm run qa:edge -- assistant A00`.

For the populated A00 prototype state, seed only the dedicated fixture and
start the preview against it:
`npm run qa:edge:seed`, then
`EDGE_QA_DATA_ROOT=work/edge-qa-a00-data npm run qa:edge:preview -- 4174`.
Capture a raw same-size comparison with
`EDGE_QA_URL=http://localhost:4174/ npm run qa:edge -- assistant A00-final`.
To compose the actual 393×852 CSS viewport inside the reusable iPhone bezel,
run `EDGE_QA_URL=http://localhost:4174/ npm run qa:edge -- assistant A00-iphone '' iphone`.
The page screenshot remains available as `A00-iphone-screen.png` next to the
framed `A00-iphone.png`.

The Node executables were downloaded from the [official Node.js 24 release](https://nodejs.org/dist/v24.21.0/)
and its ZIP SHA-256 was checked against the release's `SHASUMS256.txt`:
`158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541`.
The Linux archive SHA-256 was also checked:
`fd8e59d5a511510f6a298afb548f18c7d2b1be404d8d340fef2d1575d289ad2`.
Playwright and Playwright Core 1.63.0 came from the local npm cache.

The QA runner is a visual and browser smoke-check tool, not proof that the
screen matches a prototype. A comparison requires the same data state as the
reference. The current reference is `../../doc/screens/A00.png` at 860×2100 px;
`npm run qa:edge:seed` creates a separate fixture with two suggestions and one
running task matching that reference's content structure. To present a capture
inside the supplied reusable iPhone bezel, pass `iphone` as the fourth argument
to `scripts/edge-qa.sh`; the raw app viewport is preserved as a sibling
`*-screen.png` file.

For a live preview with the interactive app inside the reusable iPhone bezel,
open `http://127.0.0.1:4174/_preview/iphone`. This wrapper is separate from
`/`, which continues to serve the normal app.
