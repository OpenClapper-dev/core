import { render } from "preact";
// The design system's one stylesheet (tokens, fonts, every component), as in the Studio; then the board's layout.
import "@openclapper/design/styles.css";
import "./admin.css";
import { App } from "./App";

render(<App />, document.getElementById("app")!);
