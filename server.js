/**
 * server.js — GSTIN Bulk Validator (Render-ready)
 * Uses gstinapi.in for GSTIN lookups — no Puppeteer, no CAPTCHA
 */

const express = require("express");
const multer  = require("multer");
const ExcelJS = require("exceljs");
const axios   = require("axios");
const path    = require("path");
const stream  = require("stream");

const app  = express();
const PORT = process.env.PORT || 3000;
const GSTIN_API_KEY = process.env.GSTIN_API_KEY || ""; // fallback for self-hosted

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ── GSTIN format validator ─────────────────────────────────────────────────
function isValidFormat(gstin) {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin);
}

// ── Lookup single GSTIN via gstinapi.in ───────────────────────────────────
async function lookupGSTIN(gstin, apiKey) {
  const g   = gstin.trim().toUpperCase();
  const key = apiKey || GSTIN_API_KEY;

  if (!isValidFormat(g)) {
    return {
      gstin: g, status: "Invalid Format",
      legalName: "-", tradeName: "-", registrationDate: "-",
      gstnType: "-", stateCode: g.substring(0, 2), address: "-", error: "Invalid GSTIN format"
    };
  }

  if (!key) {
    return {
      gstin: g, status: "No API Key",
      legalName: "-", tradeName: "-", registrationDate: "-",
      gstnType: "-", stateCode: g.substring(0, 2), address: "-",
      error: "GSTIN_API_KEY not set. Add it in environment variables."
    };
  }

  try {
    const resp = await axios.get(`https://api.gstinapi.in/v1/gstin/${g}`, {
      headers: { "x-api-key": key },
      timeout: 15000
    });

    const d = resp.data;
    return {
      gstin:            d.gstin            || g,
      status:           d.status           || "Unknown",
      legalName:        d.legal_name       || "-",
      tradeName:        d.trade_name       || "-",
      registrationDate: d.registration_date|| "-",
      cancellationDate: d.cancellation_date|| "-",
      gstnType:         d.taxpayer_type    || "-",
      constitution:     d.business_constitution || "-",
      stateCode:        d.state_code       || g.substring(0, 2),
      address:          d.address          || "-",
      pincode:          d.pincode          || "-",
      error:            null
    };

  } catch (err) {
    const status = err.response?.status;
    let msg = err.message;
    if (status === 404) msg = "GSTIN not found on GST portal";
    if (status === 402) msg = "API credit limit reached — buy more credits at gstinapi.in";
    if (status === 401) msg = "Invalid API key";
    return {
      gstin: g, status: status === 404 ? "Not Found" : "API Error",
      legalName: "-", tradeName: "-", registrationDate: "-",
      gstnType: "-", stateCode: g.substring(0, 2), address: "-", error: msg
    };
  }
}

// ── Extract GSTINs from Excel/CSV buffer ──────────────────────────────────
async function extractGSTINs(buffer, mimetype) {
  const found = new Set();

  if (mimetype && mimetype.includes("csv")) {
    const text = buffer.toString("utf8");
    for (const cell of text.split(/[\r\n,;]+/)) {
      const v = cell.trim().toUpperCase().replace(/['"]/g, "");
      if (v.length === 15) found.add(v);
    }
    return [...found];
  }

  const wb = new ExcelJS.Workbook();
  const s  = new stream.PassThrough();
  s.end(buffer);
  await wb.xlsx.read(s);
  wb.eachSheet(sheet => {
    sheet.eachRow(row => {
      row.eachCell(cell => {
        const v = String(cell.value || "").trim().toUpperCase();
        if (v.length === 15) found.add(v);
      });
    });
  });
  return [...found];
}

// ── API: validate single GSTIN ─────────────────────────────────────────────
app.get("/api/validate/:gstin", async (req, res) => {
  const apiKey = req.headers["x-api-key"] || GSTIN_API_KEY;
  const result = await lookupGSTIN(req.params.gstin, apiKey);
  res.json(result);
});

// ── API: upload Excel → validate all → return results ─────────────────────
app.post("/api/validate-excel", upload.fields([{ name: "file", maxCount: 1 }]), async (req, res) => {
  const file = req.files?.file?.[0];
  if (!file) return res.status(400).json({ error: "No file uploaded." });

  let gstins;
  try {
    gstins = await extractGSTINs(file.buffer, file.mimetype);
  } catch (e) {
    return res.status(400).json({ error: "Could not read file: " + e.message });
  }

  if (!gstins.length) {
    return res.status(400).json({ error: "No GSTINs found. Make sure the file has 15-character GSTIN values." });
  }

  // Stream results via SSE so user sees progress live
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ type: "start", total: gstins.length });

  const apiKey = req.body?.apiKey || req.headers["x-api-key"] || GSTIN_API_KEY;
  const results = [];
  for (let i = 0; i < gstins.length; i++) {
    const result = await lookupGSTIN(gstins[i], apiKey);
    results.push(result);
    send({ type: "result", index: i, total: gstins.length, result });
    // 300ms gap to avoid rate limiting
    if (i < gstins.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  send({ type: "done", total: results.length, results });
  res.end();
});

// ── API: download results as Excel ─────────────────────────────────────────
app.post("/api/download", async (req, res) => {
  const { results } = req.body;
  if (!results?.length) return res.status(400).json({ error: "No results." });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("GSTIN Results");

  ws.columns = [
    { header: "S.No",              key: "sno",          width: 6  },
    { header: "GSTIN",             key: "gstin",        width: 20 },
    { header: "Status",            key: "status",       width: 14 },
    { header: "Legal Name",        key: "legalName",    width: 40 },
    { header: "Trade Name",        key: "tradeName",    width: 30 },
    { header: "Registration Date", key: "regDate",      width: 18 },
    { header: "Cancellation Date", key: "cancelDate",   width: 18 },
    { header: "Taxpayer Type",     key: "gstnType",     width: 22 },
    { header: "Constitution",      key: "constitution", width: 25 },
    { header: "State Code",        key: "stateCode",    width: 12 },
    { header: "Address",           key: "address",      width: 45 },
    { header: "Pincode",           key: "pincode",      width: 10 },
    { header: "Remarks",           key: "remarks",      width: 40 }
  ];

  // Header style
  const hdr = ws.getRow(1);
  hdr.font      = { bold: true, color: { argb: "FFFFFFFF" } };
  hdr.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A365D" } };
  hdr.alignment = { vertical: "middle", horizontal: "center" };
  hdr.height    = 22;

  const colors = {
    "Active":    "FFC6F6D5",
    "Cancelled": "FFFED7D7",
    "Suspended": "FFFEFCBF",
    "Not Found": "FFE2E8F0",
    "Invalid Format": "FFE2E8F0"
  };

  results.forEach((r, i) => {
    const row = ws.addRow({
      sno:         i + 1,
      gstin:       r.gstin,
      status:      r.status,
      legalName:   r.legalName    || "-",
      tradeName:   r.tradeName    || "-",
      regDate:     r.registrationDate || "-",
      cancelDate:  r.cancellationDate || "-",
      gstnType:    r.gstnType     || "-",
      constitution:r.constitution || "-",
      stateCode:   r.stateCode    || "-",
      address:     r.address      || "-",
      pincode:     r.pincode      || "-",
      remarks:     r.error        || ""
    });
    const clr = colors[r.status] || "FFE9D8FD";
    row.getCell("status").fill      = { type: "pattern", pattern: "solid", fgColor: { argb: clr } };
    row.getCell("status").font      = { bold: true };
    row.getCell("status").alignment = { horizontal: "center" };
    row.getCell("gstin").font       = { name: "Courier New" };
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];

  res.setHeader("Content-Disposition", "attachment; filename=GSTIN_Results.xlsx");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await wb.xlsx.write(res);
  res.end();
});

// ── Health check for Render ────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`✅ GSTIN Validator running on port ${PORT}`);
});
