import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/style.css";
import "./styles/workflow.css";

import "./styles/theme.css";
import {initializeAppearance} from "./lib/appearance";
await initializeAppearance();

createRoot(document.getElementById("root")!).render(<App />);

