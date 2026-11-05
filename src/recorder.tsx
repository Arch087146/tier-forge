import React from "react";
import ReactDOM from "react-dom/client";
import { RecorderHud } from "./components/RecorderHud";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RecorderHud />
  </React.StrictMode>
);
