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

if (isTauriRuntime) {
  // The desktop app owns its context menus (account/group menus); the WebView2
  // default menu (back/refresh/save-as/print) is browser noise. Text fields keep
  // the native menu so cut/copy/paste still works there.
  document.addEventListener("contextmenu", event => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
