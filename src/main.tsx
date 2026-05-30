import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ensureDefaultApiKeys } from "./secrets/bootstrap";

void ensureDefaultApiKeys();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
