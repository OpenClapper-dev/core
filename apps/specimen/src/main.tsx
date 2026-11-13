import "@openclapper/design/styles.css";
import "./specimen.css";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { CARDS } from "./registry";
import Desktop from "./kits/Desktop";
import Layouts from "./kits/Layouts";
import Phone from "./kits/Phone";

const KITS = [
  { id: "desktop", name: "Assembled desktop", Component: Desktop },
  { id: "layouts", name: "Window templates", Component: Layouts },
  { id: "phone", name: "Phone companion", Component: Phone },
];
const GROUPS = [...new Set(CARDS.map((c) => c.group))];

const useHash = () => {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const on = () => setHash(location.hash); addEventListener("hashchange", on); return () => removeEventListener("hashchange", on); }, []);
  return hash.replace(/^#\/?/, "");
};

function App() {
  const route = useHash();
  const kit = KITS.find((k) => route === `kit/${k.id}`);
  if (kit) return <div className="sp-full"><kit.Component /><a className="sp-back oc-btn oc-btn--sm" href="#/">Specimens</a></div>;
  const card = CARDS.find((c) => route === `card/${c.id}`) ?? CARDS[0];
  return (
    <div className="sp">
      <nav className="sp-nav" aria-label="Specimens">
        <h2>Kits</h2>
        {KITS.map((k) => <a key={k.id} href={`#/kit/${k.id}`}>{k.name}</a>)}
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
