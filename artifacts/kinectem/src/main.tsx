// Self-hosted Inter (was Google Fonts CDN): the share-image capture
// (html-to-image) cannot inline cross-origin stylesheets, so a CDN font
// silently falls back in the exported PNG. Bundling the font fixes both
// the app and the capture.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/inter/900.css";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
