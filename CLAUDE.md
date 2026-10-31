# CLAUDE.md: icantell

## Read first
reference/brief.md (gitignored) holds who this is for, the target phone and the agreed scope. Read it before any work. Nothing personal from it goes into this file, the README, the code, commit messages or icons.

Cloud sessions (claude.ai/code) clone the repo without reference/. There, the opening prompt carries the brief and the banned-names list: write them to reference/brief.md and reference/scrub_list.json before any work, so the scrub check runs instead of skipping. reference/ stays gitignored; never commit it.

## What this is
I can tell (repo icantell) is a colour-naming tool for people with red-green colour vision deficiency, installed as a PWA from GitHub Pages (jeuron-hue/icantell, public, jeuron-hue.github.io/icantell). Private working tool, not a portfolio piece.

The user point is speed and discretion. Open, point, read, close in a couple of seconds. Nothing on screen or on the home screen should announce colour blindness. Every design choice is judged against that.

## Hard rule: nothing leaves the phone
- The camera feed is processed in the browser, frame by frame, and never recorded, saved or sent. No uploads, no cloud APIs, no analytics, no telemetry.
- Enforce it: a Content-Security-Policy meta tag with connect-src 'self', and a test that fails if the code contains fetch/XHR/WebSocket/sendBeacon to any other origin.
- No libraries or fonts from CDNs. Vendor everything into the repo so the app works fully offline after first load.
- The only thing stored is settings (the test result, chosen mode) in localStorage, wrapped in try/catch. The app must work with storage empty or blocked.

## Architecture
- Vanilla JS and CSS. No framework, no build step, no bundler, no server.
- icantell.html holds the whole app. Allowed extra files, and only these: manifest.webmanifest, sw.js, icons/, vendor/ (fonts and their OFL licence texts), and index.html as a no-script redirect stub so jeuron-hue.github.io/icantell/ opens the app. Test tooling (package.json and package-lock.json pinning Playwright, the three test files) sits beside it; icantell_checks.cjs enforces the allowed set.
- sw.js caches the app shell and vendor/ on install. Version the cache name and bump it with every release; show an "update available, reload" prompt.
- Manifest: display standalone, short_name "I can tell". Icon is plain and neutral (no eye, no colour wheel, no red/green pairing).
- Camera: getUserMedia with facingMode environment, opened the moment the app opens. Torch toggle when the track supports it (useful in dim places). If permission is refused, say so in one line with how to allow it.
- Sampling: draw the current video frame to an offscreen canvas and read a patch under the crosshair (median over a square about 2% of the frame's short side, as a named constant; a fixed 15 px proved too small and flickered on the phone). Average over about 1 s of frames (no name until the first full set, while the camera settles) and add hysteresis so the name does not flicker between two neighbours: a new name must repeat a few readings in a row, and a plain name shown last time is favoured near a boundary (a "between" answer is not).
- Colour maths: sRGB to linear to OKLab/OKLCh. One module of pure functions (conversion, naming, difference) so they can be unit tested and mutated.
- Naming: a curated table of about 30 everyday colour names (red, maroon, pink, orange, brown, beige, yellow, olive, lime, green, teal, turquoise, blue, navy, purple, lavender, magenta, grey, black, white and so on), each with an OKLab centre. Output is family plus a plain modifier from lightness and chroma ("dark green", "greyish blue", "bright orange"). When a sample sits near a boundary between two different families, say so ("between green and yellow") rather than pick one with false confidence; the two names go in alphabetical order so the words stay put. Within one family (pink and magenta, orange and tan) the nearer name wins and no "between" is shown; the family grouping is one named constant, and a colour against grey always counts as two families. Keep the table as one named constant. Below a chroma threshold the sample is black, grey or white by lightness alone; otherwise the nearest chromatic centre wins on a weighted distance of lightness, chroma and hue angle (hue counted by angle so a dull colour still finds its family). Weights and thresholds are named constants.
- Light correction (white tap): the user points the crosshair at something white or light grey (paper, a wall) and taps White. That patch becomes the reference: a per-channel gain in linear RGB (von Kries style) makes it read neutral, and every later sample gets the same gain before naming or Compare. Held in memory only, until the app closes or the user clears it, since the light changes when you move. A small marker shows when it is on. A reference that is too dark or too colourful is refused with a one-line reason; limits are named constants.
- Calibration to the phone, not to ideal colours: the chroma cutoffs and modifiers are set from real phone readings (the phone test notes in reference/), because a phone camera reads less chroma indoors than the true colour has. The grey cutoff drops as lightness drops, so a dark navy or dark green is not called grey.
- Compare: two locked sample points, difference as OKLab delta E, reported in words: "same colour", "very close", "different". When different, add what differs in plain terms ("left is redder", "right is darker"). Thresholds are named constants.
- Paste mode (still images): in a computer's browser, a screenshot on the clipboard pastes in with Cmd+V or Ctrl+V (drag and drop and a file picker as well); on the phone, the manifest share_target accepts an image shared from another app, handled in sw.js. The image is held in memory only, never saved or sent. Pointing at it (mouse hover) or tapping anywhere names the colour there, with the same sampling, naming and hysteresis; Compare works on two points of the image. Screen pixels are exact sRGB, so the camera calibration constants do not apply to still images: they use the ideal thresholds, kept as a separate named set. The White tap stays available for a photo of a real scene. On a device with no rear camera (a laptop or desktop), the app opens in Paste mode instead of showing the webcam. The CSP gains blob: for img-src only; connect-src stays 'self'. Nothing needs installing on the computer, so it works on a managed machine.
- Freeze: one tap freezes the frame so the user can read it, and show someone, without holding the phone up.
- Layout: must work on a foldable's narrow outer screen and its near-square inner screen, portrait and landscape, and survive folding or unfolding mid-use (resize and orientation events). Camera fills the screen; the answer sits in large type in one band. Tap targets at least 44 px.
- Record the pinned version of every vendored file in the file header build notes. Never upgrade one silently.

## Design
Lab Book (Gary's design system). Load the lab-book-design skill; if it is not available, read https://claude.ai/artifact/9Gxm7gcSPntP3pqxrDJxnj. The live camera view is full-bleed; Lab Book applies to the chrome, the answer band, sheets and the test screens. Self-host every font in vendor/ (offline requirement).

## v1 features
1. Name it: crosshair on the live camera, colour family plus shade in large plain words. Opens straight into this.
2. Light: white tap correction and the torch. Lighting is the biggest cause of wrong names (phone test, 26/10/26), so this comes before Compare.
3. Compare: two points, same or different, with what differs.
4. Freeze.
5. Paste: name colours in a pasted screenshot on a computer, or an image shared in on the phone.
6. Check: a short colour vision test of our own design, generated in code (dot plates with figures placed along protan and deutan confusion lines). Not the Ishihara plates, which are copyrighted. Result is protan, deutan, or unclear, stored as a setting, and shown as a guide, not a diagnosis. Name it and Compare do not depend on it.

## After v1
7. Separate: daltonise the live view, moving the red-green difference onto the blue-yellow axis, tuned to the Check result. Care needed: a bad tuning can make blue and yellow confusions worse. A strength slider and a hold-to-see-original.
8. Find: the user picks a colour family; everything else in the live view goes grey.

## Out of scope for now
System-wide overlay, any network feature, saving images. Hover-to-name tools that need installing on a computer are parked (see reference/brief.md); Paste mode covers computers without an install.

## Build order
Phase 1: shell, PWA install, camera, Name it. (Done, 0.1.0.)
Phase 2: Light. White tap correction and torch first, then retune the names against corrected phone readings (chroma cutoffs, the "between" family rule) and fix the flicker (bigger patch, about 1 s averaging, more repeats before a change). Retuning comes after the correction so the warm cast of indoor light is not baked into the thresholds.
Phase 3: Compare, freeze.
Phase 4: Paste mode (clipboard and share target).
Phase 5: Check (the test). v1 is complete here.
Phase 6: Separate.
Phase 7: Find.
Gate at the end of each phase: each phase is built on its own branch (phase-1, phase-2, ...) and pushed to GitHub with all suites green. Gary reviews and merges to main, GitHub Pages deploys, Gary tests on the target phone and confirms before the next phase starts. Nothing reaches main with a failing suite. No partial builds.
Builds may run in cloud sessions (claude.ai/code) or locally on the rig; both follow the same gate.

## Versions and changes
The same rule runs in every app repo (retouch, filter, travelboard, icantell), agreed with Gary 30/10/26. The full method is in the version-release skill.
- Numbers run x.y.z. Patch (z): a fix or retuning, nothing new to learn. Minor (y): something new Gary can do, a finished phase, or a visible redesign; the patch goes back to 0. Major (x): 1.0.0 only when Gary declares the app finished after real use; after that x moves only when something old stops working (saved data, a file format). Until then the app stays on 0.x.
- One version per release. A release is any change to the app that reaches main. Docs-only and test-only work carries no bump and is listed in the next version's entry. A work-in-progress checkpoint does not bump the version; the bump goes in the commit that completes the release.
- The bump changes APP_VERSION in icantell.html, VERSION in sw.js (this renames the cache, so the installed app offers the update) and version in package.json, and the version line in the build notes at the top of icantell.html, together, in the release commit, and the commit subject ends with (vX.Y.Z).
- CHANGELOG.md gets the version's entry in the same commit, at the top (newest first): a heading `## vX.Y.Z, dd/mm/yy HHMM hrs`, optionally followed by `, <phase>`, giving the date and time the release commit is made, in Singapore time; then one or more `- ` lines saying what changed, in plain words. Reasons and phone results stay in this file. A released entry is changed only to correct a fact. The README's Versions section explains the numbering and points to CHANGELOG.md; it keeps no list of its own.
- Map: 0.1.0 Phase 1, 0.2.0 Phase 2 (Light), 0.3.0 Phase 3 (Compare), 0.4.0 Phase 4 (Paste), 0.5.0 Phase 5 (Check, v1 complete), 0.6.0 Phase 6, 0.7.0 Phase 7. Patches go between them as needed.
- A fix found in phone testing ships as a patch on its own branch (fix-0.1.1, ...) under the same gate as a phase.
- icantell_checks.cjs fails if a heading lacks the version, date or time, the newest entry is not the current version, versions or times are out of order, or an entry has no change line.
- Each release is built on its own branch and merged by Gary through a pull request; GitHub deletes the branch when the pull request is merged. Releases are tagged vX.Y.Z on their commit in main from the rig, in a batch when Gary asks (version-release skill, section 2). A build session stops at the merge: it does not tag, delete branches, or mention either (a cloud session cannot push tags or delete branches).

## Testing
- icantell_checks.cjs (static): CSP present, no external origins, no CDN URLs, required and allowed files only, vendored versions and sha256 recorded, app, cache and package versions match, CHANGELOG.md in step with APP_VERSION (see Versions and changes), no personal names in tracked files (the banned list is reference/scrub_list.json; the check skips cleanly when it is absent).
- icantell_behave.cjs (behavioural): real Chromium via Playwright with a fake camera (--use-fake-device-for-media-stream and --use-file-for-fake-video-capture) fed a generated .y4m of known colour patches, so names, compare results and freeze can be asserted. Unit tests on the colour module: round-trip conversions, every table centre names itself, boundary cases report "between", delta E thresholds.
- icantell_mutate.sh: mutation runner over the colour module. Survivors mean the tests get tightened.
- Everything green before any commit.
- Phone testing: after each merge, open jeuron-hue.github.io/icantell on the target phone and install it from Chrome's menu.

## Working with Gary
- Gary is a process chemist learning to code. Explain each layer in plain words as you build it: what it does and why, not just the code.
- Dates dd/mm/yy, 24-hour times, SI units, no em dashes in docs or UI text.
- README is public and plain. reference/ is gitignored and never pushed.
- Plans and this file are updated in place; no addenda.
- Findings get written down, not scheduled, unless they are hurting something now.
