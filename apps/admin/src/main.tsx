import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AdminAuthProvider } from "./auth/AdminAuthContext.js";
import { router } from "./router.js";
import "./admin.css";
import { initializeTheme, ThemeProvider } from "../../ui/Theme.js";

initializeTheme();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("main.tsx: #root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider><AdminAuthProvider>
      <RouterProvider router={router} />
    </AdminAuthProvider></ThemeProvider>
  </React.StrictMode>,
);
