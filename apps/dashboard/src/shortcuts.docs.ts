// Writes docs/shortcuts.md: node apps/dashboard/src/shortcuts.docs.ts > docs/shortcuts.md
import { shortcutsMarkdown } from "./shortcuts.ts";

process.stdout.write(`${shortcutsMarkdown()}\n`);
