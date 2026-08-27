import { Events, System, Window } from "@wailsio/runtime";

export async function installWindowsTitlebar(): Promise<void> {
  let platform = System.IsMac() ? "darwin" : System.IsWindows() ? "windows" : "";
  if (!platform) {
    try {
      platform = (await System.Environment()).OS;
    } catch {
      return;
    }
  }
  if (platform === "darwin") {
    document.documentElement.classList.add("wails-mac");
    return;
  }
  if (platform !== "windows" || document.getElementById("wails-window-controls")) return;

  document.documentElement.classList.add("wails-frameless");
  const controls = document.createElement("div");
  controls.id = "wails-window-controls";
  controls.setAttribute("aria-label", "窗口控制");
  // Segoe Fluent Icons (Windows 11) / Segoe MDL2 Assets (Windows 10) carry the real
  // caption glyphs the shell draws. Hand-rolled SVG strokes land on half pixels at
  // every scaling factor except 100%; the system font is hinted for all of them.
  controls.innerHTML = `
    <button class="wails-min" type="button" title="最小化" aria-label="最小化"><span aria-hidden="true">\uE921</span></button>
    <button class="wails-max" type="button" title="最大化" aria-label="最大化"></button>
    <button class="wails-close" type="button" title="关闭" aria-label="关闭"><span aria-hidden="true">\uE8BB</span></button>`;
  document.body.appendChild(controls);

  const maximise = controls.querySelector<HTMLButtonElement>(".wails-max");
  const minimise = controls.querySelector<HTMLButtonElement>(".wails-min");
  const close = controls.querySelector<HTMLButtonElement>(".wails-close");
  if (!maximise || !minimise || !close) return;

  const renderMaximise = async () => {
    const maximised = await Window.IsMaximised();
    maximise.title = maximised ? "还原" : "最大化";
    maximise.setAttribute("aria-label", maximise.title);
    // ChromeRestore / ChromeMaximize.
    maximise.innerHTML = maximised
      ? '<span aria-hidden="true">\uE923</span>'
      : '<span aria-hidden="true">\uE922</span>';
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
