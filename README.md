# I can tell

A small colour-naming tool for an Android phone, installed from this site as an app (PWA). Point the camera at something and it tells you the colour in plain words, or whether two things are the same colour. Made with red-green colour vision deficiency in mind.

Open it at jeuron-hue.github.io/icantell, then use Chrome's menu, "Add to home screen" or "Install app".

## Nothing leaves the phone

- The camera image is read in the browser, frame by frame. Nothing is recorded, saved or sent. There is no server, no upload, no analytics.
- The page carries a Content-Security-Policy that only lets it talk to its own site, so the browser itself blocks any attempt to send data elsewhere.
- After the first visit the app works with no network at all.

## Versions

In development. Numbers run x.y.z: the middle number goes up when a feature is added, the last one for fixes. It stays below 1.0.0 until the app is declared finished. Every version, with its release date and time and what changed, is in [CHANGELOG.md](CHANGELOG.md), newest first.

## Tests

`npm install`, then `npm test`. That runs the static checks, the behaviour tests (the app in a real browser with a fake camera playing known colours) and the mutation runner over the colour maths.

## Known limitations

- The phone camera adjusts its own white balance, so names can drift under strongly coloured light (warm lamps, neon). Comparing two things side by side under the same light is more reliable than a single name.
