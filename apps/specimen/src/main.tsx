import "@openclapper/design/styles.css";
import "./specimen.css";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { CARDS } from "./registry";
import Desktop from "./kits/Desktop";
import Layouts from "./kits/Layouts";
import Phone from "./kits/Phone";
import U1Browser from "./ux/u1/Browser";
import U2Canvas from "./ux/u2/Canvas";
import U3Windows from "./ux/u3/Windows";

const KITS = [
  { id: "desktop", name: "Assembled desktop", Component: Desktop },
  { id: "layouts", name: "Window templates", Component: Layouts },
  { id: "phone", name: "Phone companion", Component: Phone },
];
// Prototypes of the rewrite's UX workshops (docs/rewrite/ux-plan.md): clickable, on fake data.
const UX = [
  { id: "u1", name: "U1 · Files and properties", Component: U1Browser },
  { id: "u2", name: "U2 · Canvas", Component: U2Canvas },
  { id: "u3", name: "U3 · Shot, set, location", Component: U3Windows },
];
const GROUPS = [...new Set(CARDS.map((c) => c.group))];

const useHash = () => {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const on = () => setHash(location.hash); addEventListener("hashchange", on); return () => removeEventListener("hashchange", on); }, []);
  return hash.replace(/^#\/?/, "");
};

function App() {
  const route = useHash();
  const kit = KITS.find((k) => route === `kit/${k.id}`) ?? UX.find((k) => route === `ux/${k.id}`);
  if (kit) return <div className="sp-full"><kit.Component /><a className="sp-back oc-btn oc-btn--sm" href="#/">Specimens</a></div>;
  const card = CARDS.find((c) => route === `card/${c.id}`) ?? CARDS[0];
  return (
    <div className="sp">
      <nav className="sp-nav" aria-label="Specimens">
        <h2>Kits</h2>
        {KITS.map((k) => <a key={k.id} href={`#/kit/${k.id}`}>{k.name}</a>)}
        <h2>UX workshops</h2>
        {UX.map((k) => <a key={k.id} href={`#/ux/${k.id}`}>{k.name}</a>)}
        {GROUPS.map((g) => (
          <div key={g}>
            <h2>{g}</h2>
            {CARDS.filter((c) => c.group === g).map((c) => <a key={c.id} href={`#/card/${c.id}`} aria-current={c === card ? "page" : undefined}>{c.name}</a>)}
          </div>
        ))}
      </nav>
      <main className="sp-main sp-card">
        <header className="sp-head"><h1>{card.name}</h1><p>{card.subtitle}</p></header>
        <card.Component />
      </main>
    </div>
  );
}

render(<App />, document.getElementById("root")!);
