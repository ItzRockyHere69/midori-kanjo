import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import BillingApp from "../app/BillingApp";
import "../app/globals.css";
import {
  applyInterfaceScale,
  readInterfaceScaleCache,
} from "../lib/interface-scale";
import { applyTheme, readInitialTheme } from "../lib/theme";

document.documentElement.classList.add("native-app");
applyTheme(readInitialTheme());
applyInterfaceScale(readInterfaceScaleCache());

// The native desktop round-trip harness is compiled only for the dedicated
// GitHub runner test build. It is tree-shaken out of every production build.
if (import.meta.env.MODE === "desktop-e2e") {
  void import("../desktop-e2e/harness");
}

const root = document.getElementById("root");
if (!root) throw new Error("Midori Kanjo could not start.");

createRoot(root).render(
  <StrictMode>
    <BillingApp />
  </StrictMode>,
);
