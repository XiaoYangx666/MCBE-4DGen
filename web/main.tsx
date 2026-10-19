import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";
import "./workflow.css";

import "./theme.css";
import {initializeAppearance} from "./appearance";
await initializeAppearance();

createRoot(document.getElementById("root")!).render(<App />);

