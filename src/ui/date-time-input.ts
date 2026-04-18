// T042 — Date + time inputs. Keyboard-accessible, ARIA-labelled.
// Commits on change (instant) and blur.
import { getObservation, setObservation, subscribe } from "../app/observation-store";

export function mountDateTimeInput(parent: HTMLElement): void {
  const panel = document.createElement("div");
  panel.className = "panel row";
  panel.setAttribute("aria-label", "Observation date and time");

  const dateLabel = document.createElement("label");
  const dateSpan = document.createElement("span");
  dateSpan.textContent = "Date";
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.value = getObservation().localDate;
  dateInput.addEventListener("change", () => {
    setObservation({ localDate: dateInput.value });
  });
  dateLabel.append(dateSpan, dateInput);

  const timeLabel = document.createElement("label");
  const timeSpan = document.createElement("span");
  timeSpan.textContent = "Time";
  const timeInput = document.createElement("input");
  timeInput.type = "time";
  timeInput.step = "60";
  timeInput.value = getObservation().localTime;
  timeInput.addEventListener("change", () => {
    setObservation({ localTime: timeInput.value });
  });
  timeLabel.append(timeSpan, timeInput);

  const readout = document.createElement("span");
  readout.className = "readout";
  readout.setAttribute("aria-live", "off");

  panel.append(dateLabel, timeLabel, readout);
  parent.append(panel);

  const refresh = () => {
    const obs = getObservation();
    if (dateInput.value !== obs.localDate) dateInput.value = obs.localDate;
    if (timeInput.value !== obs.localTime) timeInput.value = obs.localTime;
    const sign = obs.utcOffsetMinutes < 0 ? "−" : "+";
    const abs = Math.abs(obs.utcOffsetMinutes);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    readout.textContent = `${obs.timeZone} (UTC${sign}${hh}:${mm})`;
  };
  subscribe(refresh);
  refresh();
}
