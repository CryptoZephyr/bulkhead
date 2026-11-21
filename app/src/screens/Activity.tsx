// Activity (#/activity), docs/DESIGN_SYSTEM.md section 16.7. Real rows from the testnet record, grouped by day, newest first.
import { useState } from "react";
import { StatusMark } from "../ui/Status";
import { ACTIVITY, FILTERS, matches, type ActivityFilter } from "../data/activity";
import { TxPlate } from "./Replay";
import "./activity.css";

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function ActivityScreen() {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  // Stored oldest first; show newest first, grouped by day.
  const newest = [...ACTIVITY].reverse().filter((i) => matches(i, filter));
  const days = [...new Set(newest.map((i) => i.day))];

  return (
    <div className="activity">
      <div className="plate activity-intro">
        <p className="label">Testnet history: the QOR parity account and the fUSD demo account</p>
        <p className="muted">
          Real results from the QoreChain testnet, 21 November 2026. The demo account is a test account. Use test funds only.
        </p>
      </div>

      <fieldset className="activity-filter">
        <legend>Show</legend>
        <div className="filter-row">
          {FILTERS.map((f) => (
            <label key={f.id} className="filter-chip">
              <input type="radio" name="activity-filter" value={f.id} checked={filter === f.id}
                onChange={() => setFilter(f.id)} />
              <span>{f.label}</span>
            </label>
          ))}
        </div>
        <p className="muted filter-help">Needs attention lists sealed accounts and attempts the chain refused.</p>
      </fieldset>

      {newest.length === 0 && <p className="plate muted">Nothing in this view yet.</p>}

      {days.map((day) => (
        <section key={day} className="activity-day" aria-labelledby={`day-${day}`}>
          <h2 id={`day-${day}`} className="day-head">{dayLabel(day)}</h2>
          <ul className="activity-list">
            {newest.filter((i) => i.day === day).map((item) => (
              <li key={item.id} className="plate act-row">
                <div className="act-main">
                  <span className="act-what">{item.what}</span>
                  <span className="muted act-detail">{item.detail}</span>
                </div>
                <div className="act-side">
                  <span className="act-amount">{item.amount}</span>
                  <span className="act-comp label">{item.compartment}</span>
                  <StatusMark kind={item.status} />
                </div>
                <div className="act-hash">
                  <TxPlate hash={item.hash} label={item.what} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
