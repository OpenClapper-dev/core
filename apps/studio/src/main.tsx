import { render } from "preact";
// The design system's one stylesheet (tokens, fonts, every component), then the shell's own layout.
import "@openclapper/design/styles.css";
import "./shell.css";
import "./theme";
import "./extensions";
import { EmbedCanvas, EmbedFile, embedOf } from "./embed";
import { Shell } from "./wm/Shell";

// The canvas editor alone, for the phone and tablet app's web view; else the desktop.
const embed = embedOf(location.hash);
render(embed ? (embed.kind === "canvas" ? <EmbedCanvas id={embed.id} theme={embed.theme} /> : <EmbedFile kind={embed.kind} id={embed.id} theme={embed.theme} />) : <Shell />, document.getElementById("app")!);
