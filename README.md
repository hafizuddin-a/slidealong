# SlideAlong

Present anywhere. Let your audience follow your slides on any device.

## How it works

1. The presenter uploads a PDF (up to 50 MB) and gets a 6-character session code.
2. Viewers open the app, enter the code, and the slides appear on their device.
3. As the presenter navigates — buttons or arrow keys — all viewers update in real time.

No app install required. No screen sharing. Works on any phone or tablet browser.

## Tech

- **Firebase Realtime Database** — session signaling and slide sync
- **PDF.js** — renders slides onto `<canvas>` in the browser
- Zero build step — plain HTML, CSS, and JavaScript
