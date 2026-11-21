// Hash routing: each screen is a plain #/name link (no router library).
// The root is the landing page. Screens that show an account need one; until setup has made one,
// they show where to start instead of anything made up.
import { useEffect, useState, type ReactElement } from "react";
import { Shell } from "./ui/Shell";
import { myAccount } from "./chain/me";
import { HullScreen } from "./screens/Hull";
import { PayScreen } from "./screens/Pay";
import { ReceiveScreen } from "./screens/Receive";
import { WallsScreen } from "./screens/Walls";
import { AgentScreen } from "./screens/Agent";
import { ActivityScreen } from "./screens/Activity";
import { ProofScreen } from "./screens/Proof";
import { HelpScreen } from "./screens/Help";
import { LandingScreen } from "./screens/Landing";
import { PhoneScreen } from "./screens/Phone";
import { SettingsScreen } from "./screens/Settings";
import { SetupScreen } from "./screens/Setup";

type ScreenDef = { title: string; sentence: string; body: () => ReactElement; needsAccount?: boolean };

const SCREENS: Record<string, ScreenDef> = {
  hull: { title: "Your hull", sentence: "What you hold, and the most anyone could take right now.", body: () => <HullScreen />, needsAccount: true },
  pay: { title: "Pay", sentence: "Send money inside your walls. Anything bigger goes to your phone.", body: () => <PayScreen />, needsAccount: true },
  receive: { title: "Receive", sentence: "Your account's address, and funding from QoreX.", body: () => <ReceiveScreen />, needsAccount: true },
  walls: { title: "Walls", sentence: "Tighten instantly. Widening goes to your phone.", body: () => <WallsScreen />, needsAccount: true },
  agent: { title: "Bills", sentence: "Your bill agent pays your regular bills from its own capped account.", body: () => <AgentScreen />, needsAccount: true },
  activity: { title: "Activity", sentence: "Everything that happened, read from the chain.", body: () => <ActivityScreen />, needsAccount: true },
  setup: { title: "Set up Bulkhead", sentence: "Let's build your hull. It takes about two minutes.", body: () => <SetupScreen /> },
  proof: { title: "Contracts and proof", sentence: "Check every address yourself.", body: () => <ProofScreen /> },
  help: { title: "Help", sentence: "Short answers to real questions.", body: () => <HelpScreen /> },
  settings: { title: "Account", sentence: "Theme, recovery account and your phone.", body: () => <SettingsScreen /> },
};

function NoAccountYet() {
  return (
    <div className="plate" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ color: "var(--on-plate)" }}>You don't have an account on this laptop yet</h2>
      <p>Setup creates your laptop key, pairs your phone and builds your account. It takes about two minutes.</p>
      <a className="btn btn-primary" href="#/setup" style={{ justifySelf: "start" }}>Start setup</a>
    </div>
  );
}

export function useRoute() {
  const read = () => location.hash.replace(/^#\/?/, "").split("?")[0];
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
  const s = SCREENS[route];
  useEffect(() => { document.title = s ? `${s.title} · Bulkhead` : "Bulkhead"; }, [s]);
  if (route === "" || route === "landing" || !s) return <LandingScreen />;
  if (route === "phone") return <PhoneScreen />;
  const body = s.needsAccount && !myAccount() ? <NoAccountYet /> : s.body();
  return <Shell route={route} title={s.title} sentence={s.sentence}>{body}</Shell>;
}
