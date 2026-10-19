import { render } from "preact";
// The web design system (tokens, component classes and components), shared with the Studio.
import "@fielder/ui";
import "./admin.css";
import { App } from "./App";

render(<App />, document.getElementById("app")!);
