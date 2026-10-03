# 🏛️ GSTIN Bulk Validator

Bulk-validate Indian GSTINs (Active / Cancelled / Suspended) by uploading an Excel file. Live on Render — no installation needed.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

---

## ✨ Features

- 📊 **Upload any Excel file** — GSTINs detected from any column automatically
- ⚡ **Instant bulk validation** — results stream in live as each GSTIN is checked
- ✅ **Active / Cancelled / Suspended** status with legal name, address, registration date
- ⬇️ **Download results** as a colour-coded Excel file
- 🔍 **Single GSTIN check** — type any GSTIN and get instant result
- 🌐 **Fully cloud-hosted** on Render — works from any browser, no install

---

## 🚀 Deploy to Render (Free)

### Step 1 — Get a free API key
1. Go to **[gstinapi.in](https://www.gstinapi.in)**
2. Sign up (free, no credit card)
3. Go to Dashboard → API Keys → Create key → Copy it

### Step 2 — Deploy on Render
1. Fork this repo on GitHub
2. Go to **[render.com](https://render.com)** → New → Web Service
3. Connect your forked GitHub repo
4. Set these values:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
5. Add Environment Variable:
   - Key: `GSTIN_API_KEY`
   - Value: *(paste your key from gstinapi.in)*
6. Click **Deploy** — your app goes live at `https://your-app.onrender.com`

---

## 💻 Run Locally

```bash
git clone https://github.com/shubham-9122/gstin-bulk-validator.git
cd gstin-bulk-validator
npm install
cp .env.example .env
# Edit .env and add your GSTIN_API_KEY
node server.js
# Open http://localhost:3000
```

---

## 📁 Project Structure

```
gstin-bulk-validator/
├── server.js          # Express backend — API calls, Excel parsing, SSE streaming
├── public/
│   └── index.html     # Frontend — drag & drop, live results table, download
├── render.yaml        # Render deployment config
├── .env.example       # Environment variable template
└── package.json
```

---

## 📊 Excel Input

GSTINs can be in **any column**, any row. The tool finds all 15-character values automatically.

| GSTIN           |
|-----------------|
| 27AAPFU0939F1ZV |
| 29AAGCM6462N1Z7 |

---

## 📤 Excel Output

Colour-coded results with:
- ✅ **Active** — green
- ❌ **Cancelled** — red
- ⚠️ **Suspended** — yellow

Columns: GSTIN, Status, Legal Name, Trade Name, Registration Date, Cancellation Date, Taxpayer Type, Constitution, State Code, Address, Pincode

---

## 🔑 API Credits

| Plan | Lookups | Price |
|------|---------|-------|
| Free | 100 | ₹0 |
| Starter | 250 | ₹199 |
| Popular | 1,200 | ₹599 |
| Scale | 6,250 | ₹2,499 |

Credits never expire. Get them at [gstinapi.in](https://www.gstinapi.in).

---

## 🛠️ Tech Stack

- **Node.js** + **Express** — backend
- **gstinapi.in** — GSTIN data (official GSP network)
- **ExcelJS** — read/write Excel
- **Server-Sent Events** — live result streaming
- **Render** — free cloud hosting

---

## 📄 License

MIT — free to use and modify.
