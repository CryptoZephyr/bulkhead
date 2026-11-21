import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./ui/ui.css";
import App from "./App";

// Apply the saved theme before the first frame (also inlined in index.html).
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
