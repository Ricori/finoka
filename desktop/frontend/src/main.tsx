import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { installWindowsTitlebar } from "./bridge/window.ts";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Finoka root element is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void installWindowsTitlebar();
