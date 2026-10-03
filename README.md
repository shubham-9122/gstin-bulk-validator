# 🏛️ GSTIN Bulk Validator — GST Portal Automation

Bulk-validate Indian GSTINs (Active / Cancelled / Suspended) by automating the official GST portal. No unofficial APIs, no third-party services — uses a real Chrome browser session with your own GST login.

---

## ✨ Features

- 🔐 **You log in** to the GST portal once — tool reuses your session
- ⌨️ **Auto-types** each GSTIN into the search box one by one
- 🔐 **You solve the CAPTCHA** and click Search (takes ~5 seconds per GSTIN)
- ✅ **Tool scrapes** Active / Cancelled / Suspended automatically
- 📊 **Drop any Excel file** — GSTINs detected from any column
- 📈 **Live results table** with colour-coded statuses as each result comes in
- ⬇️ **Download results** as a formatted Excel file

---

## 🚀 Quick Start

### Requirements
- [Node.js](https://nodejs.org) v18 or higher
- Windows 10 / 11

### Install & Run

```bash
git clone https://github.com/shubham-9122/gstin-bulk-validator.git
cd gstin-bulk-validator
npm install
```

Then double-click **`LAUNCH.vbs`** — browser opens automatically at `http://localhost:3000`.

---

## 📋 How It Works

```
1. Double-click LAUNCH.vbs
2. Browser opens → click "Open GST Portal Login"
3. Real Chrome opens → log in with your GST credentials
4. Click "I'm Logged In" in the browser tool
5. Drop your Excel file with GSTINs
6. Click "Start Validation"
7. For each GSTIN:
   - Tool types GSTIN automatically ✅
   - You solve CAPTCHA + click Search (5 sec) ✅
   - Tool reads result automatically ✅
8. Download final Excel with all results
```

---

## 📁 Project Structure

```
gstin-bulk-validator/
├── server.js              # Express backend + SSE live updates
├── gstin-automation.js    # Puppeteer automation (types GSTINs, scrapes results)
├── LAUNCH.vbs             # One-click launcher (starts server + opens browser)
├── public/
│   └── index.html         # Frontend UI (4-step wizard)
└── package.json
```

---

## 📊 Excel Input Format

Your Excel file can have GSTINs in **any column** — the tool automatically finds all 15-character GSTIN values.

| GSTIN           |
|-----------------|
| 27AAPFU0939F1ZV |
| 29AAGCM6462N1Z7 |
| 07AABCU9603R1ZP |

---

## 📤 Excel Output

| S.No | GSTIN           | Status    | Legal Name       | Trade Name | Reg. Date  | GSTN Type | State |
|------|-----------------|-----------|------------------|------------|------------|-----------|-------|
| 1    | 27AAPFU0939F1ZV | Active    | ABC Pvt Ltd      | ABC        | 01-07-2017 | Regular   | 27    |
| 2    | 29AAGCM6462N1Z7 | Cancelled | XYZ Traders      | XYZ        | 15-09-2018 | Regular   | 29    |

---

## ⚠️ Important Notes

- This tool uses **your own GST portal login** — your credentials are never stored or transmitted anywhere
- The CAPTCHA must be solved manually (this is intentional — the GST portal WAF blocks automation of the captcha)
- Validated at ~1 GSTIN per 10–15 seconds (time to solve captcha + click)
- Works with `.xlsx`, `.xls`, and `.csv` files

---

## 🛠️ Tech Stack

- **Node.js** + **Express** — backend server
- **Puppeteer** — headless/visible Chrome automation
- **ExcelJS** — read/write Excel files
- **Server-Sent Events (SSE)** — live result streaming to browser

---

## 📄 License

MIT License — free to use and modify.
