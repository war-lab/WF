// スマホの入口（BD04 3章）。/p?room=<部屋の ID>
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PlayerApp } from "./player/App.tsx";
import "./theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlayerApp />
  </StrictMode>,
);
