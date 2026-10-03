/**
 * gstin-automation.js
 * Opens a REAL visible Chrome window.
 * 1. User logs in to GST portal
 * 2. For each GSTIN: tool types it in the search box
 * 3. User solves CAPTCHA and clicks Search
 * 4. Tool waits for result, scrapes it, moves to next
 */

const puppeteer = require("puppeteer");

const GST_URL = "https://services.gst.gov.in/services/searchtp";

let browser = null;
let page    = null;

// ── Launch visible Chrome on GST search page ─────────────────────────────
async function launch() {
  if (browser) {
    try { await browser.close(); } catch (_) {}
    browser = null; page = null;
  }

  const isRender = !!process.env.RENDER;

  browser = await puppeteer.launch({
    headless: isRender ? true : false,   // headless on Render, visible locally
    defaultViewport: isRender ? { width: 1280, height: 800 } : null,
    executablePath: isRender
      ? '/opt/render/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome'
      : undefined,                        // use bundled Chrome locally
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,800",
      ...(isRender ? [] : ["--start-maximized"])
    ]
  });

  const pages = await browser.pages();
  page = pages[0] || await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  browser.on("disconnected", () => { browser = null; page = null; });

  await page.goto(GST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
}

// ── Check if user is logged in ────────────────────────────────────────────
async function checkLoggedIn() {
  if (!page || !browser) return false;
  try {
    const url  = page.url();
    const text = await page.evaluate(() => document.body.innerText || "");
    // After login the portal shows username or dashboard link
    const loggedIn =
      url.includes("/auth/")    ||
      url.includes("dashboard") ||
      text.includes("Welcome")  ||
      text.includes("Log Out")  ||
      text.includes("Logout")   ||
      !!await page.$(".user-name, .loggeduser, [class*='username']").catch(() => null);
    return loggedIn;
  } catch (_) {
    return false;
  }
}

// ── Type a GSTIN into the search box ─────────────────────────────────────
async function typeGSTIN(gstin) {
  if (!page) throw new Error("Browser not open");

  // Go to search page if not already there
  const url = page.url();
  if (!url.includes("searchtp")) {
    await page.goto(GST_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));
  }

  // Wait for input
  await page.waitForSelector("#for_gstin", { timeout: 10000 });

  // Clear and type
  await page.click("#for_gstin");
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await new Promise(r => setTimeout(r, 300));
  await page.type("#for_gstin", gstin, { delay: 80 });
}

// ── Wait for result after user solves CAPTCHA and clicks Search ───────────
async function waitForResult(gstin, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!browser || !page) throw new Error("Browser was closed");

    try {
      const data = await page.evaluate((g) => {
        const body = document.body.innerText || "";

        // Result not shown yet if GSTIN isn't on the page
        if (!body.includes(g)) return null;

        // Check for "no record" messages
        if (
          body.includes("No record found") ||
          body.includes("not found") ||
          body.includes("Invalid GSTIN/UIN") ||
          body.includes("does not exist")
        ) {
          return { gstin: g, status: "Not Found", legalName: "-", tradeName: "-", registrationDate: "-", gstnType: "-" };
        }

        // Detect status from page text
        let status = "Unknown";
        if (/\bActive\b/i.test(body))    status = "Active";
        else if (/\bCancelled\b/i.test(body)) status = "Cancelled";
        else if (/\bSuspended\b/i.test(body)) status = "Suspended";
        else if (/\bProvisional\b/i.test(body)) status = "Provisional";

        if (status === "Unknown") return null; // still loading

        // Scrape details from result table
        function labelVal(label) {
          const idx = body.indexOf(label);
          if (idx === -1) return "-";
          const after = body.substring(idx + label.length, idx + label.length + 150).trim();
          const lines = after.split("\n").map(l => l.trim()).filter(l => l && l !== ":" && l !== "-");
          return lines[0] || "-";
        }

        return {
          gstin:            g,
          status:           status,
          legalName:        labelVal("Legal Name")         || labelVal("Trade Name"),
          tradeName:        labelVal("Trade Name"),
          registrationDate: labelVal("Date of Registration") || labelVal("Registration Date"),
          gstnType:         labelVal("Constitution of Business") || labelVal("Taxpayer Type"),
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
    error: "No result appeared. Did you click Search?"
  };
}

// ── Run all GSTINs in sequence ────────────────────────────────────────────
async function runBatch(gstins, onProgress) {
  const results = [];

  for (let i = 0; i < gstins.length; i++) {
    const gstin = gstins[i].trim().toUpperCase();

    // Validate format locally — no need to go to portal for bad format
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

    // Tell frontend: typing now
    onProgress({ type: "typing", index: i, total: gstins.length, gstin });

    try {
      await typeGSTIN(gstin);
    } catch (e) {
      const r = {
        gstin, status: "Error",
        legalName: "-", tradeName: "-",
        registrationDate: "-", gstnType: "-",
        stateCode: gstin.substring(0, 2),
        error: "Could not type GSTIN: " + e.message
      };
      results.push(r);
      onProgress({ type: "result", index: i, total: gstins.length, result: r });
      continue;
    }

    // Tell frontend: waiting for captcha
    onProgress({ type: "waiting_captcha", index: i, total: gstins.length, gstin });

    // Wait for user to solve captcha + click Search
    const result = await waitForResult(gstin);
    results.push(result);
    onProgress({ type: "result", index: i, total: gstins.length, result });

    // Brief pause before next GSTIN
    if (i < gstins.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  onProgress({ type: "done", total: gstins.length, results });
  return results;
}

async function closeBrowser() {
  if (browser) {
    try { await browser.close(); } catch (_) {}
    browser = null; page = null;
  }
}

module.exports = { launch, checkLoggedIn, typeGSTIN, waitForResult, runBatch, closeBrowser };
