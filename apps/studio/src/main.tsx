import { render } from "preact";
// The design system's one stylesheet (tokens, fonts, every component), then the shell's own layout.
import "@openclapper/design/styles.css";
import "./shell.css";
import "./theme";
import { Shell } from "./wm/Shell";

render(<Shell />, document.getElementById("app")!);
