import { render } from "preact";
// The dashboard's design system (tokens, component classes and components), so both boards look alike.
import "../../../dashboard/src/ui";
import "./admin.css";
import { App } from "./App";

render(<App />, document.getElementById("app")!);
