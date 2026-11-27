// Shows what the phone did with a request this screen sent: waiting, approved (with its transaction) or refused.
import { useEffect, useState } from "react";
import { StatusMark } from "./Status";

type State = { status: "waiting" | "approved" | "refused" | "expired" | "unknown"; txHash?: string };

export function PhoneStatus({ requestId, what }: { requestId: string; what: string }) {
  const [s, setS] = useState<State>({ status: "waiting" });
  useEffect(() => {
    let on = true;
    const read = async () => {
      try {
        const r = await fetch(`/api/requests?id=${requestId}`).then((x) => x.json());
        if (on) setS({ status: r.status ?? "unknown", txHash: r.txHash });
        return r.status === "waiting";
      } catch { return true; }
    };
    void read();
    const t = setInterval(async () => { if (!(await read())) clearInterval(t); }, 4000);
    return () => { on = false; clearInterval(t); };
  }, [requestId]);
  const text = {
    waiting: `Waiting for your phone to approve ${what}.`,
    approved: `Your phone approved ${what}. The chain accepted it.`,
    refused: `Your phone refused ${what}. Nothing moved.`,
    expired: `This request expired before your phone answered. Nothing moved.`,
    unknown: `Couldn't read this request. Check your phone.`,
  }[s.status];
  return (
    <p role="status" aria-live="polite" style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
      <StatusMark kind={s.status === "approved" ? "paid" : s.status === "waiting" ? "phone" : "blocked"} />
      <span>{text}</span>
    </p>
  );
}
