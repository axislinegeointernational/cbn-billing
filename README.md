# CBN FULL — Membership Fee Receipt App

Mobile-first web app that generates the CBN **Membership Fee Receipt** as a PDF.
Static files only: no Node, no build, no backend. It runs on GitHub Pages.

## Files
| File | Purpose |
|---|---|
| `index.html` | App screens (Bill · Records · Settings) |
| `styles.css` | App UI + the exact receipt layout |
| `app.js` | Logic: numbering, PDF, WhatsApp log, storage, sync |
| `data/cbn-data.json` | The JSON "database" (all receipts + counters) |
| `manifest.webmanifest`, `icon.svg` | "Add to Home screen" support |

## Put it online (5 minutes)
1. Create a GitHub repo, e.g. `cbn-full`, and upload all files in this folder (keep the `data/` folder).
2. Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch `main` / `(root)` → Save.
3. Open `https://<your-username>.github.io/cbn-full/` on your phone → browser menu → **Add to Home screen**.

## Daily use
1. **Bill** tab → type the member name. If they paid before, their details and membership no. fill in automatically.
2. Check the amount (default ₹3,500) and remarks, then tap **Save & Generate PDF**.
3. WhatsApp opens with the receipt log addressed to **+91 95396 37747**. Tap send.
4. Back in the app: **Download PDF** or **Share PDF**, which sends the PDF straight to the member on WhatsApp.
5. **Records** tab: search, re-download, re-send, **Edit** or **Delete** any receipt.

Receipt No. (`CBN/2026/00001`…) and Membership No. are generated automatically. Both fields can still be edited by hand.
To start from a specific number (e.g. continue from 123), go to **Settings → Numbering**.

## Where the data is stored (no backend)
The app saves every receipt in three places:

1. **Phone browser storage**, saved instantly. This is lost if the cache or site data is cleared.
2. **WhatsApp log**. Each saved receipt is sent as a message that ends with a **restore link**.
   Tap the link and the receipt loads back into the app.
   To restore everything at once: Settings → paste the WhatsApp chat text → **Restore from pasted text**.
3. **JSON file in GitHub (recommended)**. The app writes `data/cbn-data.json` through the GitHub API,
   so counters and records survive cache clears and stay the same across phones.

### Turn on the GitHub JSON sync
1. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token.
   - Repository access: *Only select repositories* → pick the repo.
   - Permissions → **Contents: Read and write**.
2. In the app, open **Settings → Cloud JSON**: Owner = your username, Repo = repo name, Branch = `main`,
   File path = `data/cbn-data.json`, Token = the token → **Save settings & sync**.
3. The badge at the top right shows **✓ Cloud hh:mm** when sync works.
   After a cache clear, enter the token again. All data and numbering come back.

> **Privacy:** free GitHub Pages needs a **public** repo, so `data/cbn-data.json` there is publicly readable.
> To keep the data private, create a second **private** repo (e.g. `cbn-data`) and put that repo name in the
> sync settings. The app stays public but the data does not. The token stays on your phone only.

## Backup
Settings → **Export JSON** downloads a full backup. **Import JSON** merges it back without making duplicates.

## Notes
- Needs internet for fonts and the PDF library (loaded from cdnjs and Google Fonts).
- Financial year in Remarks is set automatically (April–March) and can be edited.
- This is a quick, personal tool. Add proper login and security before sharing it with others.
