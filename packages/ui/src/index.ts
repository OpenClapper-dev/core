/**
 * The web component library (`@fielder/ui`), shared by the Studio and the admin board: every page
 * imports its building blocks from here, so the design system is applied in one place. Files follow
 * the design system's groups; the CSS they render lives in ./design (tokens + component classes, see
 * docs/design.md) and comes along with any import from this package. Client-only CSS (the desktop
 * shell, photo framing, page layouts) stays in the client.
 */
import "./design/colors.css";
import "./design/typography.css";
import "./design/spacing.css";
import "./design/actions.css";
import "./design/navigation.css";
import "./design/forms.css";
import "./design/overlays.css";
import "./design/data.css";
import "./design/feedback.css";
import "./design/studio.css";
import "./design/components.css";

export * from "./core";
export * from "./forms";
export * from "./navigation";
export * from "./data";
export * from "./feedback";
export * from "./overlays";
export * from "./Combobox";
export * from "./actions";
export * from "./layout";
export * from "./hooks";
export * from "./Markdown";
export * from "./theme";
