import { render } from "preact";
// Design system: tokens, component classes and components come with @openclapper/ui; then the
// client's own CSS (photo framing, the desktop shell) and styles.css with the page layouts.
import "@openclapper/ui";
import "./openclapper.css";
import "./wm/desktop.css";
import "./styles.css";
import { Shell } from "./wm/Shell";

// The desktop shell (epic #72). The old App.tsx stays compilable while its pages are ported
// into apps over phases 4–7, but it is no longer mounted.
render(<Shell />, document.getElementById("app")!);
