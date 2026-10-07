import { DEFAULT_APP_NAME } from "../shared/theme";

// The tab title is built from two owners: the app shell sets the brand name, alerts add a prefix in front of it.
let base = DEFAULT_APP_NAME;
let prefix = "";
let page = "";

function apply() {
  document.title = `${prefix}${page ? `${page} · ` : ""}${base}`;
}

/** Names what the tab is showing (e.g. the theme being edited), ahead of the app name. */
export function setPageTitle(next: string) {
  page = next;
  apply();
}

export function setBaseTitle(next: string) {
  base = next;
  apply();
}

export function setTitlePrefix(next: string) {
  prefix = next;
  apply();
}
