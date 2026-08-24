import { Events, System, Window } from "@wailsio/runtime";

export async function installWindowsTitlebar(): Promise<void> {
  let isWindows = System.IsWindows();
  if (!isWindows) {
    try {
      isWindows = (await System.Environment()).OS === "windows";
    } catch {
      return;
    }
  }
  if (!isWindows || document.getElementById("wails-window-controls")) return;

  document.documentElement.classList.add("wails-frameless");
  const controls = document.createElement("div");
  controls.id = "wails-window-controls";
  controls.setAttribute("aria-label", "窗口控制");
  controls.innerHTML = `
    <button class="wails-min" type="button" title="最小化" aria-label="最小化">
      <svg viewBox="0 0 11 11" aria-hidden="true"><path d="M1 5.5h9"/></svg>
    </button>
    <button class="wails-max" type="button" title="最大化" aria-label="最大化"></button>
    <button class="wails-close" type="button" title="关闭" aria-label="关闭">
      <svg viewBox="0 0 11 11" aria-hidden="true"><path d="M1 1l9 9M10 1 1 10"/></svg>
    </button>`;
  document.body.appendChild(controls);

  const maximise = controls.querySelector<HTMLButtonElement>(".wails-max");
  const minimise = controls.querySelector<HTMLButtonElement>(".wails-min");
  const close = controls.querySelector<HTMLButtonElement>(".wails-close");
  if (!maximise || !minimise || !close) return;

  const renderMaximise = async () => {
    const maximised = await Window.IsMaximised();
    maximise.title = maximised ? "还原" : "最大化";
    maximise.setAttribute("aria-label", maximise.title);
    maximise.innerHTML = maximised
      ? '<svg viewBox="0 0 11 11" aria-hidden="true"><path d="M3 1.5h6.5V8H8M1.5 3H8v6.5H1.5z"/></svg>'
      : '<svg viewBox="0 0 11 11" aria-hidden="true"><rect x="1.5" y="1.5" width="8" height="8"/></svg>';
  };

  minimise.onclick = () => void Window.Minimise();
  maximise.onclick = () => void Window.ToggleMaximise();
  close.onclick = () => void Window.Close();

  Events.On("common:WindowMaximise", () => void renderMaximise());
  Events.On("common:WindowUnMaximise", () => void renderMaximise());
  Events.On("common:WindowRestore", () => void renderMaximise());
  Events.On("common:WindowFullscreen", () => document.documentElement.classList.add("wails-fullscreen"));
  Events.On("common:WindowUnFullscreen", () => document.documentElement.classList.remove("wails-fullscreen"));
  void renderMaximise();
}
