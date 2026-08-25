import type { Theme } from "./types.ts";

export function initialTheme(): Theme {
  return new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  const light = theme === "light";
  document.documentElement.classList.toggle("light", light);
  document.body.classList.toggle("light", light);
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", light ? "#f7f5ef" : "#171b2a");
}
