// T060 (pulled forward — only 15 lines, and US1 shows the banner too).
// Toggles the out-of-range caveat banner per the Q1 clarification / FR-007.
import { isOutsideVerifiedDateRange, subscribe } from "../app/observation-store";

export function mountCaveatBanner(el: HTMLElement): void {
  const apply = (outside: boolean) => {
    if (outside) {
      el.hidden = false;
      el.textContent =
        "Outside the verified date range (1900–2100); astronomical accuracy is degraded.";
    } else {
      el.hidden = true;
      el.textContent = "";
    }
  };
  subscribe((obs) => apply(isOutsideVerifiedDateRange(obs)));
  // Initial state.
  apply(false);
}
