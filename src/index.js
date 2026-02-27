import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```
Click **Commit new file**.

---

**Step 4 — If `public/_redirects` is missing on GitHub**
Go to GitHub → **Add file → Create new file** → type `public/_redirects` → paste this single line:
```
/*    /index.html    200
