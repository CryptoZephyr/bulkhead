// Help (#/help), docs/DESIGN_SYSTEM.md section 16.11. Short plain answers, then the full hero footer.
import { HeroFooter } from "../ui/Shell";
import "./help.css";


const QA: { q: string; a: string[] }[] = [
  {
    q: "What is a blast radius?",
    a: [
      "It is the most money that could leave an account right now if its laptop key were stolen.",
      "The number is read from QoreChain, not estimated. It is the figure under 'If your laptop were stolen now' on your hull.",
    ],
  },
  {
    q: "Why does my phone need to approve?",
    a: [
      "Anything that could let money leave faster than your walls allow needs the post-quantum key on your phone.",
      "Widening a wall needs it, and so does moving money out of Savings. Tightening a wall never does. It happens at once from the laptop.",
    ],
  },
  {
    q: "What happens if I lose my phone?",
    a: [
      "Savings can't move without the phone, and the laptop can't widen a wall. Everyday still spends inside its walls.",
      "Your recovery account is set during setup. Replacing a lost phone is not built yet, so keep the phone safe.",
    ],
  },
  {
    q: "What happens if my laptop is stolen?",
    a: [
      "The thief has the laptop key. That key can spend only inside its walls, up to the per-payment cap.",
      "A payment over the cap seals the account. A sealed account moves nothing until your phone approves. Savings never moves without the phone.",
    ],
  },
  {
    q: "What is the bill agent allowed to do?",
    a: [
      "It pays approved bills from its own account, and nothing else. On chain it may only call the fUSD transfer.",
      "It can pay at most 10 fUSD per payment and 25 fUSD per day. It can't reach your Bulkhead account. The chain refuses anything over those limits, not the app.",
    ],
  },
];

export function HelpScreen() {
  return (
    <div className="help">
      <div className="help-list">
        {QA.map((item) => (
          <details key={item.q} className="plate help-item">
            <summary>{item.q}</summary>
            {item.a.map((p) => <p key={p}>{p}</p>)}
          </details>
        ))}
      </div>
      <HeroFooter cta={<a className="btn btn-primary" href="#/setup">Create my Bulkhead</a>} />
    </div>
  );
}
