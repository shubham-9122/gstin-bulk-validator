/**
 * server.js — GSTIN Bulk Validator with GST Portal Automation
 * Flow:
 *  1. User opens http://localhost:3000
 *  2. Clicks "Open GST Portal Login" → visible Chrome opens
 *  3. User logs in manually
 *  4. User uploads Excel with GSTINs
 *  5. Tool auto-types each GSTIN, user solves captcha + clicks Search
 *  6. Tool captures result, moves to next GSTIN
 *  7. User downloads final Excel
 */

const express    = require("express");
const multer     = require("multer");
const ExcelJS    = require("exceljs");
const path       = require("path");
const stream     = require("stream");
const automation = require("./gstin-automation");

const app  = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ── SSE clients for live progress updates ─────────────────────────────────────
const sseClients = new Set();

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (_) { sseClients.delete(res); }
  }
}

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.flushHeaders();
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// ── Step 1: Launch Chrome and open GST login ──────────────────────────────────
app.post("/api/launch", async (req, res) => {
  try {
    await automation.launch();
    broadcast({ type: "status", message: "Chrome opened. Please log in to the GST portal." });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Step 2: Poll login status ─────────────────────────────────────────────────
app.get("/api/login-status", async (req, res) => {
  try {
    const s = automation.getState();
    if (s === "login_wait") {
      // non-blocking check
      const loggedIn = await Promise.race([
        automation.waitForLogin(2000).then(() => true).catch(() => false),
        new Promise(r => setTimeout(() => r(false), 2500))
      ]);
      if (loggedIn) {
        broadcast({ type: "status", message: "✅ Login detected! Upload your Excel file to begin." });
        return res.json({ loggedIn: true });
      }
      return res.json({ loggedIn: false });
    }
    res.json({ loggedIn: s !== "idle" });
  } catch (e) {
    res.json({ loggedIn: false, error: e.message });
  }
});

// ── Step 3: Upload Excel → extract GSTINs → start batch ──────────────────────
app.post("/api/start-batch", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  let gstins;
  try {
    gstins = await extractGSTINs(req.file.buffer, req.file.mimetype);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  if (!gstins.length) {
    return res.status(400).json({ error: "No GSTINs found in the file." });
  }

  // Respond immediately with the list, then run batch in background
  res.json({ ok: true, total: gstins.length, gstins });

  // Run automation in background, stream results via SSE
  broadcast({ type: "batch_start", total: gstins.length, gstins });

  automation.runBatch(gstins, (event) => {
    broadcast(event);
  }).catch(e => {
    broadcast({ type: "error", message: e.message });
  });
});

// ── Step 4: Download results Excel ───────────────────────────────────────────
app.post("/api/download", async (req, res) => {
  const { results } = req.body;
  if (!results || !results.length) {
    return res.status(400).json({ error: "No results" });
  }

  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("GSTIN Validation Results");

  worksheet.columns = [
    { header: "S.No",              key: "sno",       width: 6  },
    { header: "GSTIN",             key: "gstin",     width: 20 },
    { header: "Status",            key: "status",    width: 14 },
    { header: "Legal Name",        key: "legalName", width: 40 },
    { header: "Trade Name",        key: "tradeName", width: 30 },
    { header: "Registration Date", key: "regDate",   width: 18 },
    { header: "GSTN Type",         key: "gstnType",  width: 22 },
    { header: "State Code",        key: "stateCode", width: 12 },
    { header: "Remarks",           key: "remarks",   width: 40 }
  ];

  // Header style
  const hdr = worksheet.getRow(1);
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
    const row = worksheet.addRow({
      sno:       i + 1,
      gstin:     r.gstin,
      status:    r.status,
      legalName: r.legalName || "-",
      tradeName: r.tradeName || "-",
      regDate:   r.registrationDate || "-",
      gstnType:  r.gstnType  || "-",
      stateCode: r.stateCode || r.gstin.substring(0, 2),
      remarks:   r.error     || ""
    });
    const clr = colors[r.status] || "FFE9D8FD";
    row.getCell("status").fill      = { type: "pattern", pattern: "solid", fgColor: { argb: clr } };
    row.getCell("status").font      = { bold: true };
    row.getCell("status").alignment = { horizontal: "center" };
    row.getCell("gstin").font       = { name: "Courier New" };
  });

  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  res.setHeader("Content-Disposition", "attachment; filename=GSTIN_Results.xlsx");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await workbook.xlsx.write(res);
  res.end();
});

// ── Close browser ─────────────────────────────────────────────────────────────
app.post("/api/close", async (req, res) => {
  await automation.closeBrowser();
  res.json({ ok: true });
});

// ── Helper: extract GSTINs from Excel buffer ──────────────────────────────────
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

  const workbook = new ExcelJS.Workbook();
  const s = new stream.PassThrough();
  s.end(buffer);
  await workbook.xlsx.read(s);

  workbook.eachSheet(sheet => {
    sheet.eachRow(row => {
      row.eachCell(cell => {
        const v = String(cell.value || "").trim().toUpperCase();
        if (v.length === 15) found.add(v);
      });
    });
  });

  return [...found];
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("\n✅  GSTIN Validator running at http://localhost:" + PORT);
  console.log("    Open that URL in your browser.\n");
});
