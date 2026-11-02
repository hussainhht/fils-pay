import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router.js";
import { initializeTheme, ThemeProvider } from "../../ui/Theme.js";

initializeTheme();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("main.tsx: #root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider><RouterProvider router={router} /></ThemeProvider>
  </React.StrictMode>,
);
