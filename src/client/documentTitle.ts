import { DEFAULT_APP_NAME } from "../shared/theme";

// The tab title is built from two owners: the app shell sets the brand name, alerts add a prefix in front of it.
let base = DEFAULT_APP_NAME;
let prefix = "";

function apply() {
  document.title = `${prefix}${base}`;
}

export function setBaseTitle(next: string) {
  base = next;
  apply();
}

export function setTitlePrefix(next: string) {
  prefix = next;
  apply();
}
