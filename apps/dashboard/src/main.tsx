import { render } from "preact";
// Design system: tokens + component classes are imported by the component library (./ui); styles.css holds the layouts.
import "./ui";
import "./styles.css";
import { Shell } from "./wm/Shell";

// The desktop shell (epic #72). The old App.tsx stays compilable while its pages are ported
// into apps over phases 4–7, but it is no longer mounted.
render(<Shell />, document.getElementById("app")!);
