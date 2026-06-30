import React from "react";
import ReactDOM from "react-dom/client";
import Root from "../shared/Root.jsx";
import Analyzer from "./App.jsx"; // the original Hebrew 9-Question tool (unchanged)

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root lang="he" Analyzer={Analyzer} />
  </React.StrictMode>
);
