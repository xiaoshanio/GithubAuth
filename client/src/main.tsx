/* Visual direction: “加密索引库” — bootstrap the local application shell without external data dependencies. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const isTauriRuntime = "__TAURI_INTERNALS__" in window;

if (!isTauriRuntime && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
