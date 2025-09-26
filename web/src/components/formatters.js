import * as d3 from "npm:d3";

export const date = d3.utcFormat("%Y-%m-%d");
export const comma = d3.format(",");

export function timeDiff(start, end) {
  const diffMs = end - start;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function seconds(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = (totalSeconds % 60).toFixed(0);

  return [
    hours > 0 ? `${hours}h` : null,
    minutes > 0 ? `${minutes}m` : null,
    seconds > 0 ? `${seconds}s` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export function minutes(x) {
  const m = Math.floor(x);
  const s = Math.floor(60 * (x - m));
  return m + ":" + (s < 10 ? "0" : "") + s;
}

export function pace(kph) {
  return minutes(60 / kph);
}
