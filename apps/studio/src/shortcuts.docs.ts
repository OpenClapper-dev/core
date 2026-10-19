// Writes docs/shortcuts.md: node apps/studio/src/shortcuts.docs.ts > docs/shortcuts.md
import { shortcutsMarkdown } from "./shortcuts.ts";

process.stdout.write(`${shortcutsMarkdown()}\n`);
