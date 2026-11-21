// The blast radius over a day: the pilot's breathing line against the flat line of a fixed cap.
// Drawn from the owner's schedule (what the pilot will do), with "now" marked. Inline SVG, tokens only.
import { quietAt, type PilotSettingsJson } from "../chain/pilot";

export function ExposureChart({ s, ceilingPerTx, decimals = 6 }: { s: PilotSettingsJson; ceilingPerTx: bigint; decimals?: number }) {
  const W = 640, H = 180, pad = { l: 44, r: 12, t: 14, b: 26 };
  const top = Number(ceilingPerTx) / 10 ** decimals || 1;
  const x = (min: number) => pad.l + (min / 1440) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const rest = Number(s.restPerTx) / 10 ** decimals, day = Number(s.dayPerTx) / 10 ** decimals;
  let d = "";
  for (let m = 0; m <= 1440; m += 10) { const v = quietAt(s, m % 1440) ? rest : day; d += `${m === 0 ? "M" : "L"}${x(m).toFixed(1)},${y(v).toFixed(1)} `; }
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const nowV = quietAt(s, nowMin) ? rest : day;
  const money = (v: number) => v.toFixed(2);
  return (
    <figure className="exposure" aria-label={`Most a stolen laptop could take, through the day. Night ${money(rest)}, daytime ${money(day)}, a fixed cap would be ${money(top)} all day.`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        <line x1={pad.l} x2={W - pad.r} y1={y(top)} y2={y(top)} className="exp-static" />
        <text x={W - pad.r} y={y(top) - 4} textAnchor="end" className="exp-label">Fixed cap {money(top)}</text>
        <path d={d} className="exp-line" />
        <line x1={x(nowMin)} x2={x(nowMin)} y1={pad.t} y2={H - pad.b} className="exp-now" />
        <circle cx={x(nowMin)} cy={y(nowV)} r="5" className="exp-dot" />
        {[0, 6, 12, 18, 24].map((h) => <text key={h} x={x(h * 60)} y={H - 6} textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"} className="exp-label">{String(h % 24).padStart(2, "0")}:00</text>)}
        <text x={pad.l - 6} y={y(0) + 4} textAnchor="end" className="exp-label">0</text>
      </svg>
      <figcaption className="muted">Most a stolen laptop could take in one payment, hour by hour. The lime line is your pilot. The flat line is what a fixed cap leaves open all day.</figcaption>
    </figure>
  );
}
