/**
 * gstin-automation.js
 * 
 * Approach:
 * - Opens a NEW visible Chrome window with remote debugging enabled
 * - User logs in to GST portal in that Chrome window
 * - Puppeteer connects to that same Chrome via CDP (no separate browser)
 * - For each GSTIN: Puppeteer types it into the search box automatically
 * - User solves CAPTCHA and clicks Search in that same Chrome window
 * - Puppeteer waits and scrapes the result
 */

const puppeteer = require("puppeteer");
const { execSync, spawn } = require("child_process");
const path = require("path");

const GST_URL   = "https://services.gst.gov.in/services/searchtp";
const DEBUG_PORT = 9222;

let browser  = null;
let page     = null;
let chromeProcess = null;

// ── Find Chrome executable path ───────────────────────────────────────────
function findChrome() {
  const paths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
    // Edge as fallback
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const p of paths) {
    try {
      require("fs").accessSync(p);
      return p;
    } catch (_) {}
  }
  return null;
}

// ── Launch Chrome with remote debugging ───────────────────────────────────
async function launch() {
  // Kill any previous instance
  if (chromeProcess) {
    try { chromeProcess.kill(); } catch (_) {}
    chromeProcess = null;
  }
  if (browser) {
    try { await browser.disconnect(); } catch (_) {}
    browser = null; page = null;
  }

  const chromePath = findChrome();
  if (!chromePath) throw new Error("Chrome or Edge not found. Please install Google Chrome.");

  // Launch Chrome with remote debugging port open
  chromeProcess = spawn(chromePath, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--start-maximized",
    GST_URL
  ], { detached: true, stdio: "ignore" });

  chromeProcess.unref();

  // Wait for Chrome to start and open the debug port
  await waitForDebugPort(DEBUG_PORT, 15000);
}

// ── Wait for Chrome debug port to be ready ────────────────────────────────
async function waitForDebugPort(port, timeoutMs) {
  const http    = require("http");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await new Promise(resolve => {
      const req = http.get(`http://localhost:${port}/json/version`, res => {
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1000, () => { req.destroy(); resolve(false); });
    });
    if (ready) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("Chrome did not start in time.");
}

// ── Connect Puppeteer to the running Chrome ───────────────────────────────
async function connectPuppeteer() {
  if (browser) return;
  browser = await puppeteer.connect({
    browserURL: `http://localhost:${DEBUG_PORT}`,
    defaultViewport: null
  });
}

// ── Check if user is logged in ────────────────────────────────────────────
async function checkLoggedIn() {
  try {
    await connectPuppeteer();
    const pages = await browser.pages();
    for (const p of pages) {
      const url  = p.url();
      const text = await p.evaluate(() => document.body?.innerText || "").catch(() => "");
      if (
        url.includes("/auth/") ||
        url.includes("dashboard") ||
        text.includes("Log Out") ||
        text.includes("Logout") ||
        text.includes("Welcome,")
      ) return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

// ── Get or create the GST search page ────────────────────────────────────
async function getGSTPage() {
  await connectPuppeteer();
  const pages = await browser.pages();

  // Find existing GST tab
  for (const p of pages) {
    if (p.url().includes("services.gst.gov.in")) {
      page = p;
      return page;
    }
  }

  // Open new tab
  page = await browser.newPage();
  await page.goto(GST_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  await new Promise(r => setTimeout(r, 3000));
  return page;
}

// ── Type a GSTIN into the search box ─────────────────────────────────────
async function typeGSTIN(gstin) {
  const p = await getGSTPage();

  // Navigate to search page if needed
  if (!p.url().includes("searchtp")) {
    await p.goto(GST_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
    await new Promise(r => setTimeout(r, 3000));
  }

  // Wait for input
  await p.waitForSelector("#for_gstin", { timeout: 10000 });

  // Clear existing value and type new GSTIN
  await p.click("#for_gstin");
  await p.keyboard.down("Control");
  await p.keyboard.press("a");
  await p.keyboard.up("Control");
  await p.keyboard.press("Backspace");
  await new Promise(r => setTimeout(r, 300));
  await p.type("#for_gstin", gstin, { delay: 80 });

  // Bring Chrome window to front so user can see the CAPTCHA
  await p.bringToFront();
}

// ── Wait for result after user solves CAPTCHA and clicks Search ───────────
async function waitForResult(gstin, timeoutMs = 180000) {
  const p       = await getGSTPage();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!browser) throw new Error("Browser was closed");

    try {
      const data = await p.evaluate((g) => {
        const body = document.body?.innerText || "";
        if (!body.includes(g)) return null;

        // No record found
        if (
          body.includes("No record found") ||
          body.includes("Invalid GSTIN") ||
          body.includes("does not exist")
        ) {
          return { gstin: g, status: "Not Found", legalName: "-", tradeName: "-",
                   registrationDate: "-", gstnType: "-" };
        }

        // Detect status
        let status = "Unknown";
        if      (/\bActive\b/i.test(body))    status = "Active";
        else if (/\bCancelled\b/i.test(body)) status = "Cancelled";
        else if (/\bSuspended\b/i.test(body)) status = "Suspended";
        else if (/\bProvisional\b/i.test(body)) status = "Provisional";

        if (status === "Unknown") return null;

        // Scrape details
        function lv(label) {
          const idx = body.indexOf(label);
          if (idx === -1) return "-";
          const after = body.substring(idx + label.length, idx + label.length + 150).trim();
          const lines = after.split("\n").map(l => l.trim()).filter(l => l && l !== ":" && l !== "-");
          return lines[0] || "-";
        }

        return {
          gstin,
          status,
          legalName:        lv("Legal Name")            || lv("Trade Name"),
          tradeName:        lv("Trade Name"),
          registrationDate: lv("Date of Registration")  || lv("Registration Date"),
          gstnType:         lv("Constitution of Business") || lv("Taxpayer Type"),
          stateCode:        g.substring(0, 2)
        };
      }, gstin);

      if (data) return data;
    } catch (_) {}

    await new Promise(r => setTimeout(r, 1000));
  }

  return {
    gstin, status: "Timeout",
    legalName: "-", tradeName: "-",
    registrationDate: "-", gstnType: "-",
    stateCode: gstin.substring(0, 2),
    error: "No result in 3 minutes. Did you solve the CAPTCHA?"
  };
}

// ── Run all GSTINs ────────────────────────────────────────────────────────
async function runBatch(gstins, onProgress) {
  const results = [];

  for (let i = 0; i < gstins.length; i++) {
    const gstin = gstins[i].trim().toUpperCase();

    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
      const r = {
        gstin, status: "Invalid Format",
        legalName: "-", tradeName: "-",
        registrationDate: "-", gstnType: "-",
        stateCode: gstin.substring(0, 2),
        error: "GSTIN format is incorrect"
      };
      results.push(r);
      onProgress({ type: "result", index: i, total: gstins.length, result: r });
      continue;
    }

    // Type GSTIN
    onProgress({ type: "typing", index: i, total: gstins.length, gstin });
    try {
      await typeGSTIN(gstin);
    } catch (e) {
      const r = { gstin, status: "Error", legalName: "-", tradeName: "-",
                  registrationDate: "-", gstnType: "-",
                  stateCode: gstin.substring(0, 2), error: e.message };
      results.push(r);
      onProgress({ type: "result", index: i, total: gstins.length, result: r });
      continue;
    }

    // Wait for captcha + result
    onProgress({ type: "waiting_captcha", index: i, total: gstins.length, gstin });
    const result = await waitForResult(gstin);
    results.push(result);
    onProgress({ type: "result", index: i, total: gstins.length, result });

    if (i < gstins.length - 1) await new Promise(r => setTimeout(r, 1500));
  }

  onProgress({ type: "done", total: gstins.length, results });
  return results;
}

async function closeBrowser() {
  if (browser) { try { await browser.disconnect(); } catch (_) {} browser = null; page = null; }
  if (chromeProcess) { try { chromeProcess.kill(); } catch (_) {} chromeProcess = null; }
}

module.exports = { launch, checkLoggedIn, typeGSTIN, waitForResult, runBatch, closeBrowser };
