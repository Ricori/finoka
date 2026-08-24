import { editorSession } from "../../editor/session.ts";

export function useTheme() {
  const theme = editorSession.use((state) => state.theme);
  return { theme, toggleTheme: () => editorSession.get().toggleTheme() };
}
