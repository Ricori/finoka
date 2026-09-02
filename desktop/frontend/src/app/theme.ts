import type { Theme } from "./types.ts";

export function initialTheme(fallback: Theme = "light"): Theme {
  const theme = new URLSearchParams(window.location.search).get("theme");
  return theme === "dark" || theme === "light" ? theme : fallback;
}

export function applyTheme(theme: Theme): void {
  const light = theme === "light";
  document.documentElement.classList.toggle("light", light);
  document.body.classList.toggle("light", light);
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", light ? "#faf9fe" : "#0f111b");
}
