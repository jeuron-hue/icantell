# I can tell: change history

What changed in each version, newest first. Each heading gives the version, the date and time it was released (Singapore time, 24-hour) and the phase. Why each change was made is in CLAUDE.md.

## v0.2.1, 06/11/26 1507 hrs, Phase 2 retune
- White now also stops the camera adjusting its brightness and colour by itself, where the phone allows it, and makes the patch you tapped read as white. White paper then reads white instead of light grey or grey, and dark and light words follow the room. Tap White again to hand control back to the camera. If the camera was closed and reopened, White stays on for colour only.
- Shades of one colour no longer say "between": blue against navy now reads "dark blue", tan against brown "light brown". "Between" is kept for different colours, such as red and orange, yellow and lime, or blue and purple.
- Dark colours are less often called grey or black: the point where a colour counts as grey drops as it gets darker.

## v0.2.0, 02/11/26 2119 hrs, Phase 2 (Light)
- White: point the crosshair at white paper or a pale wall and tap White. The colour cast of that light is then taken out of every name, and out of the L C h line, until you tap White again or close the app. A small "White on" mark shows while it is on. Something too dark or too colourful to use is refused, with a one-line reason.
- Torch: a Torch button appears when the phone's camera has a light.
- Steadier names: the patch read under the crosshair is now about 2% of the camera image's short side (at least 16 px), the reading is averaged over about 1 s, and a new name has to come up 5 readings in a row before it replaces the old one.
- Docs only, since 0.1.0: the version rule and this change history.
- Docs only, since 0.1.0: the tests run on the Windows rig as well.
- Docs only, since 0.1.0: Light moved ahead of Compare in the build order.
- Docs only, since 0.1.0: Phase 1 close-out, with the phone test result.
- Docs only, since 0.1.0: Phase 2 split into 0.2.0 (Light) and 0.2.1 (names retuned from phone readings taken with White on).

## v0.1.0, 26/10/26 1757 hrs, Phase 1
- Name it: hold the crosshair over something and read its colour in plain words, such as "dark green", "greyish blue" or "between green and lime" when it sits on the line between two names. A small line underneath gives the measured lightness, chroma and hue.

## Brief, 26/10/26 1725 hrs
- Project brief (CLAUDE.md) and README; no app code.
