# U2 · Canvas

UX workshop [#358](https://github.com/OpenClapper-dev/core/issues/358) ([plan](ux-plan.md)). Status: **round 1 built, nothing decided yet**.

The one tool for drawing, placing pictures and framing. Specified in [05](05-composition.md) and [02](02-optics.md).

## The prototype

`make specimen`, then <http://localhost:5175/#/ux/u2>. Code: `apps/specimen/src/ux/u2/`. Fake data, no server; a reload resets every change. The bar at the very top is not part of the design.

The frames are drawn with the real math of workshop 02: the base photo is 4:3 at a 24 mm equivalent (74° × 59°), and each frame is what its format, focal length, multiplier and squeeze see against that.

## Round 1: what is in it

| Part | What to try |
| --- | --- |
| A base photo with frames | The canvas opens on a photo with three frames from the preset "Pocket 6K · Sigma 18–35" at 18, 24 and 35 mm, each in its own colour: all visible at once is today's Stacked |
| Moving a frame | With the first tool (Select and move), drag a frame. It stays on the photo |
| The frame list | In the inspector: click a frame to edit it, the eye hides it, the star makes it **the picture** the canvas stands for |
| A frame from a preset | Focal length follows the preset's lenses: a slider in whole mm for a zoom, one button per focal length for primes. "+ Frame" adds one from any preset |
| A free-form frame | "+ Frame → Free-form values": format, focal length (typed, or a stop from the built-in list), multiplier, squeeze, delivery aspect; "Create a preset from this frame" |
| An aspect frame | "+ Frame → Aspect ratio only": an aspect and a size, no optics |
| Anamorphic and delivery | Add a frame from "Super 35 4-perf · 2× anamorphic": the outer frame is what the camera sees desqueezed, the dashed inner frame is the 2.39:1 delivery |
| A frame wider than the photo | Add a frame from "Full frame primes" (24 mm): it sees more than the photo, so the photo is drawn smaller, the frame dashed, the area beyond hatched |
| What a frame sees | Under each frame's settings: its angle of view and the full-frame equivalent; the status bar says how much of the photo's width it covers |
| View modes | Outline, Mask, Crop, Full in the toolbar. Mask and Crop use the picture (the starred frame, and its delivery aspect when it has one) |
| Drawing | Pen, line, arrow, rectangle, ellipse in the tool rail; ink colours appear in the toolbar; "Undo the last shape" in Layers |
| A look | Exposure, contrast and saturation under Layers; the Look checkbox switches it off |
| Blank canvas | Surface → Blank: paper to draw on, no frames |
| The edit lock | "Someone else is editing" in the top bar: the banner and a read-only tool |

## Not in round 1

Compare (two frames side by side), placed pictures, text and stencils, selecting and moving shapes, layers as a real stack, the preset create flow with its preview on example photos, the tablet.

## Questions for the owner

1. Frames as a list in the inspector with their settings underneath: right, or should a frame's settings sit on the stage next to it?
2. The star for "the picture": clear?
3. Focal length as a slider for zooms and buttons for primes: right?
4. What should round 2 take first: Compare, placed pictures and text, or the preset create flow?

## Decided

Nothing yet.
