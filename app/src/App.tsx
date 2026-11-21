// Hash routing: each screen is a plain #/name link (no router library).
import { useEffect, useState, type ReactElement } from "react";
import { Shell } from "./ui/Shell";
import { HullScreen } from "./screens/Hull";
import { PayScreen } from "./screens/Pay";
import { WallsScreen } from "./screens/Walls";
import { AgentScreen } from "./screens/Agent";
import { ActivityScreen } from "./screens/Activity";
import { ProofScreen } from "./screens/Proof";
import { HelpScreen } from "./screens/Help";
import { LandingScreen } from "./screens/Landing";
import { ReplayScreen } from "./screens/Replay";
import { PhoneScreen } from "./screens/Phone";
import { SettingsScreen } from "./screens/Settings";

type ScreenDef = { title: string; sentence: string; body: () => ReactElement; bare?: boolean };

// Screens are filled in during Phase 2. Each follows docs/DESIGN_SYSTEM.md section 16.
const SCREENS: Record<string, ScreenDef> = {
  hull: { title: "Your hull", sentence: "", body: () => <HullScreen /> },
  pay: { title: "Pay", sentence: "Send money inside your walls.", body: () => <PayScreen /> },
  walls: { title: "Walls", sentence: "Tighten instantly. Widening goes to your phone.", body: () => <WallsScreen /> },
  agent: { title: "Bill agent", sentence: "Your agent pays approved bills from its own account.", body: () => <AgentScreen /> },
  activity: { title: "Activity", sentence: "Everything that happened, with proof.", body: () => <ActivityScreen /> },
  proof: { title: "Contracts and proof", sentence: "Check every address yourself.", body: () => <ProofScreen /> },
  help: { title: "Help", sentence: "Short answers to real questions.", body: () => <HelpScreen /> },
  replay: { title: "Attack replay", sentence: "Watch a stolen laptop key fail against a real account.", body: () => <ReplayScreen /> },
  settings: { title: "Account", sentence: "Theme, recovery account and paired phone.", body: () => <SettingsScreen /> },
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
  if (route === "landing" || route === "") return <LandingScreen />;
  if (route === "phone") return <PhoneScreen />;
  return <Shell route={route} title={s.title} sentence={s.sentence}>{s.body()}</Shell>;
}
