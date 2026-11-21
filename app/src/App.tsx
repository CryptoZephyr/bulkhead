// Hash routing: each screen is a plain #/name link (no router library).
import { useEffect, useState, type ReactElement } from "react";
import { Shell } from "./ui/Shell";
import { HullScreen } from "./screens/Hull";

type ScreenDef = { title: string; sentence: string; body: () => ReactElement; bare?: boolean };

const placeholder = (what: string) => () => <div className="plate"><p>{what} is being built in Phase 2.</p></div>;

// Screens are filled in during Phase 2. Each follows docs/DESIGN_SYSTEM.md section 16.
const SCREENS: Record<string, ScreenDef> = {
  hull: { title: "Your hull", sentence: "", body: () => <HullScreen /> },
  pay: { title: "Pay", sentence: "Send money inside your walls.", body: placeholder("Pay") },
  walls: { title: "Walls", sentence: "Tighten instantly. Widening goes to your phone.", body: placeholder("Walls") },
  agent: { title: "Bill agent", sentence: "Your agent pays approved bills from its own account.", body: placeholder("Agent") },
  activity: { title: "Activity", sentence: "Everything that happened, with proof.", body: placeholder("Activity") },
  proof: { title: "Contracts and proof", sentence: "Check every address yourself.", body: placeholder("Contracts and proof") },
  settings: { title: "Account", sentence: "Theme, recovery account and paired phone.", body: placeholder("Account") },
};

export function useRoute() {
  const read = () => (location.hash.replace(/^#\/?/, "") || "hull").split("?")[0];
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => { setRoute(read()); window.scrollTo(0, 0); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

export default function App() {
  const route = useRoute();
  const s = SCREENS[route] ?? SCREENS.hull;
  useEffect(() => { document.title = `${s.title} · Bulkhead`; }, [s.title]);
  return <Shell route={route} title={s.title} sentence={s.sentence}>{s.body()}</Shell>;
}
