# The canvas on a tablet: research and the embedded editor

Build step B5 ([#377](https://github.com/OpenClapper-dev/core/issues/377)), as [05](05-composition.md) asks: research into how established canvas tools reach a fluid, interchangeable result on web and mobile, and into stylus feel and speed; then a test of the embedded way. This page records what the build rests on and what the owner tests.

## What established tools do

From their public engineering writing; the details were not verified here.

| Tool | How the canvas runs on web and mobile |
| --- | --- |
| Figma | One rendering engine written in C++, compiled to WebAssembly and drawn with WebGL in the browser; the same engine runs natively in its desktop and mobile apps. One document model, one renderer, several shells |
| Miro, tldraw, Excalidraw | The board is a web application. tldraw and Excalidraw run on tablets in the browser, with pointer events for mouse, touch and pen |
| Note and drawing apps for stylus (GoodNotes, Procreate and the like) | Native renderers tuned for latency: they draw the stroke ahead of the screen's refresh and predict the next points |

The common thread for a tool that must be the same everywhere: **one document model and one renderer**, shipped to each shell. OpenClapper has both already: the canvas body is shared code ([canvas](../features/canvas.md)) and the editor is one component; the question was whether a web view is good enough for the shell on a tablet.

## What the web gives a stylus

- **Pointer events** tell a pen (`pointerType: "pen"`) from a finger, with pressure and tilt.
- **Coalesced events** (`getCoalescedEvents()`) give every point the pen reported between two frames, not only one per frame: smoother strokes at high pen rates. The editor uses them for pen strokes.
- **`touch-action: none`** on the drawing surface stops the browser from scrolling or zooming the page under the pen. The editor's stage has it.
- **Palm rejection** is the app's job: once a pen was used, the editor treats a finger as panning, never as drawing. Two fingers zoom and pan the view (pinch).
- **Latency**: a web view draws through the browser's compositor; a native renderer can be faster. Low-latency canvas modes and prediction exist in browsers (`desynchronized` 2D contexts, predicted events) but are not used yet: the editor draws strokes as SVG.

## The embedded way, as built

- The Studio has an **embed page**, `#/embed/canvas/<id>?theme=…`: the canvas editor alone, without desktop and taskbar (`apps/studio/src/embed.tsx`), the same component as the Studio's Canvas window.
- The phone or tablet app opens it in a **web view** (`react-native-webview`) through `GET /api/web?to=<path>`: the app sends its session as a bearer header, the Worker answers with the same session as a cookie and a redirect to the page. The token never appears in an address (`apps/worker/src/web.ts`).
- The editor in the web view **holds the edit lock** and saves on its own, render included, as in the Studio. Back closes the web view; the lock is let go when the page closes, or runs out after 60 s.
- Canvas is a **tab** of the app (Setup, Tabs on this device) and the phone's Media opens a canvas's view page with Edit.

## What is to be tested on the tablet (the owner)

1. Open the Canvas tab, make a canvas, draw with a finger and with a stylus: does a stroke follow the pen closely enough, and is the result smooth?
2. Rest the hand on the screen while drawing with the stylus: does it stay out of the drawing?
3. Pinch to zoom and pan with two fingers.
4. Frames on a photo, the inspector panels and the dropdowns: usable by touch?
5. Leave and come back: is the canvas saved, and is the lock gone for the Studio?

If the feel is not good enough, the fallback of [05](05-composition.md) stands: a native renderer on the shared model. The first steps then would be a low-latency stroke layer (a native canvas under the web view, or a 2D context in `desynchronized` mode) before a whole native editor.

## Local testing

The web view loads the Studio from the server the app talks to. Locally (`make mobile`, the local Worker behind a tunnel) that Worker serves the Studio from `apps/studio/dist`: build it first with `pnpm -C apps/studio build`.
