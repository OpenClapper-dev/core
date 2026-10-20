import { Linking, Text, View } from "react-native";
import { parseMarkdown, type Block, type Inline } from "@openclapper/vocab";
import { FONT, makeStyles, type, useTheme } from "../ui";

/** Native rendering of the Markdown subset used for descriptions (packages/vocab markdown.ts). */
export function MarkdownText({ source, empty }: { source: string | null | undefined; empty?: string }) {
  const s = useStyles();
  const blocks = source ? parseMarkdown(source) : [];
  if (!blocks.length) return empty ? <Text style={s.empty}>{empty}</Text> : null;
  return <View style={{ gap: 8 }}>{blocks.map((b, i) => <BlockText key={i} b={b} />)}</View>;
}

function BlockText({ b }: { b: Block }) {
  const s = useStyles();
  if (b.kind === "heading") return <Text style={[s.body, b.level === 1 ? s.h1 : b.level === 2 ? s.h2 : s.h3]}><Inlines nodes={b.children} /></Text>;
  if (b.kind === "list") {
    return (
      <View style={{ gap: 4 }}>
        {b.items.map((it, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 8 }}>
            <Text style={[s.body, s.bullet]}>{b.ordered ? `${i + 1}.` : "•"}</Text>
            <Text style={[s.body, { flex: 1 }]}><Inlines nodes={it} /></Text>
          </View>
        ))}
      </View>
    );
  }
  return <Text style={s.body}><Inlines nodes={b.children} /></Text>;
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  const s = useStyles();
  const { c } = useTheme();
  return <>{nodes.map((n, i) => {
    switch (n.kind) {
      case "text": return n.text;
      case "strong": return <Text key={i} style={s.strong}><Inlines nodes={n.children} /></Text>;
      case "em": return <Text key={i} style={s.em}><Inlines nodes={n.children} /></Text>;
      case "code": return <Text key={i} style={s.code}>{n.text}</Text>;
      case "link": return <Text key={i} style={{ color: c.accent, textDecorationLine: "underline" }} onPress={() => void Linking.openURL(n.href)}><Inlines nodes={n.children} /></Text>;
    }
  })}</>;
}

const useStyles = makeStyles((c) => ({
  body: { ...type("body"), color: c.text },
  h1: { ...type("title", "bold"), color: c.text },
  h2: { ...type("body", "bold"), color: c.text },
  h3: { ...type("small", "bold"), color: c.textDim, textTransform: "uppercase", letterSpacing: 0.6 },
  bullet: { width: 18, textAlign: "right", color: c.textDim },
  strong: { fontFamily: FONT.bold },
  em: { fontStyle: "italic" },
  code: { fontFamily: FONT.mono, backgroundColor: c.surfaceSunken, borderRadius: 3 },
  empty: { ...type("small"), color: c.textDim },
}));
