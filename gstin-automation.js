/**
 * gstin-automation.js
 * Opens a REAL visible Chrome window.
 * - User logs in to GST portal manually
 * - For each GSTIN: tool types it in, user solves captcha + clicks Search
 * - Tool waits for result, scrapes it, emits via callback
 */

const puppeteer = require("puppeteer");

const GST_SEARCH_URL = "https://services.gst.gov.in/services/searchtp";
const GST_LOGIN_URL  = "https://services.gst.gov.in/services/login";

let browser = null;
let page    = null;
let state   = "idle"; // idle | login_wait | ready | running | done | error

// ── Launch browser and navigate to login page ─────────────────────────────────
async function launch() {
  if (browser) {
    try { await browser.close(); } catch (_) {}
  }

  browser = await puppeteer.launch({
    headless: false,                       // VISIBLE Chrome window
    defaultViewport: null,                 // Full window size
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--start-maximized"
    ]
  });

  const pages = await browser.pages();
  page = pages[0] || await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  // Detect if user closes Chrome
  browser.on("disconnected", () => {
    browser = null;
    page    = null;
    state   = "idle";
  });

  // Navigate to login
  await page.goto(GST_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  state = "login_wait";
}

// ── Poll until user is logged in (dashboard appears) ─────────────────────────
async function waitForLogin(timeoutMs = 300000) {
  if (!page) throw new Error("Browser not launched");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!browser || !page) throw new Error("Browser was closed");

    const url = page.url();
    // After login GST portal redirects to dashboard or home
    if (url.includes("/services/dashboard") || url.includes("/services/home") ||
        url.includes("auth/searchtpbypan")  || url.includes("auth/searchtp")) {
      state = "ready";
      return true;
    }

    // Also check if the top-right shows user name (logged in indicator)
    const loggedIn = await page.evaluate(() => {
      const txt = document.body.innerText || "";
      return txt.includes("Welcome") || txt.includes("Dashboard") ||
             !!document.querySelector(".user-info, .loggeduser, [class*='welcome'], [class*='user-name']");
    }).catch(() => false);

    if (loggedIn) {
      state = "ready";
      return true;
    }

    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error("Login timeout — 5 minutes elapsed");
}

// ── Navigate to the Search Taxpayer page ──────────────────────────────────────
async function goToSearchPage() {
  if (!page) throw new Error("Browser not available");
  const url = page.url();
  if (!url.includes("searchtp")) {
    await page.goto(GST_SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
    await new Promise(r => setTimeout(r, 3000));
  }
}

// ── Type one GSTIN into the search box ───────────────────────────────────────
async function typeGSTIN(gstin) {
  await goToSearchPage();

  // Wait for the GSTIN input
  await page.waitForSelector("#for_gstin, input[name='for_gstin'], input[placeholder*='GSTIN']", {
    timeout: 15000
  });

  // Clear and type
  await page.click("#for_gstin, input[name='for_gstin'], input[placeholder*='GSTIN']");
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");

  await page.type(
    "#for_gstin, input[name='for_gstin'], input[placeholder*='GSTIN']",
    gstin,
    { delay: 60 }
  );
}

// ── Wait for search result after user clicks Search ───────────────────────────
// Waits up to `timeoutMs` for the result panel to appear, then scrapes it.
async function waitForResult(gstin, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!browser || !page) throw new Error("Browser was closed");

    const result = await page.evaluate((g) => {
      const body = document.body.innerText || "";

      // Look for known result indicators in the page
      // The GST portal shows taxpayer name + status in a result card
      const statusKeywords = {
        "Active":    ["Active"],
        "Cancelled": ["Cancelled", "Cancel"],
        "Suspended": ["Suspended", "Suspend"]
      };

      // Check if we're still on the search page showing a result
      // The result usually contains the GSTIN back + status label
      if (!body.includes(g)) return null; // result not yet shown

      // Try to find the status text near the GSTIN
      let foundStatus = "Unknown";
      for (const [status, keywords] of Object.entries(statusKeywords)) {
        for (const kw of keywords) {
          // Look for the keyword in proximity to common result labels
          const hasIt = body.includes(kw);
          if (hasIt) { foundStatus = status; break; }
        }
        if (foundStatus !== "Unknown") break;
      }

      // Scrape structured data from result card
      // GST portal renders result in a table/div with specific labels
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.innerText.trim() : null;
      };

      // Try multiple selector patterns used by the portal
      const legalName = getText(".lgnm, [class*='lgnm'], td.ng-binding:nth-child(2)")
        || scrapeLabel(body, "Legal Name")
        || scrapeLabel(body, "Trade Name");

      const tradeName = scrapeLabel(body, "Trade Name")
        || scrapeLabel(body, "Principal Place");

      const regDate   = scrapeLabel(body, "Date of Registration")
        || scrapeLabel(body, "Registration Date");

      const gstnType  = scrapeLabel(body, "Constitution of Business")
        || scrapeLabel(body, "Taxpayer Type");

      function scrapeLabel(text, label) {
        const idx = text.indexOf(label);
        if (idx === -1) return null;
        const after = text.substring(idx + label.length, idx + label.length + 100).trim();
        // Take first non-empty line after the label
        const lines = after.split("\n").map(l => l.trim()).filter(l => l && l !== ":");
        return lines[0] || null;
      }

      return {
        gstin: g,
        status: foundStatus,
        legalName: legalName  || "-",
        tradeName: tradeName  || "-",
        registrationDate: regDate || "-",
        gstnType: gstnType    || "-",
        stateCode: g.substring(0, 2)
      };
    }, gstin);

    if (result && result.status !== "Unknown") {
      return result;
    }

    // Also check if "no records found" type message appeared
    const noRecord = await page.evaluate((g) => {
      const body = document.body.innerText || "";
      return (body.includes("No record") || body.includes("not found") ||
              body.includes("Invalid GSTIN") || body.includes("does not exist")) &&
             body.includes(g);
    }, gstin).catch(() => false);

    if (noRecord) {
      return {
        gstin, status: "Not Found",
        legalName: "-", tradeName: "-",
        registrationDate: "-", gstnType: "-",
        stateCode: gstin.substring(0, 2)
      };
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  return {
    gstin, status: "Timeout",
    legalName: "-", tradeName: "-",
    registrationDate: "-", gstnType: "-",
    stateCode: gstin.substring(0, 2),
    error: "No result appeared within timeout"
  };
}

// ── Full run: iterate through GSTINs, emit progress via callback ──────────────
async function runBatch(gstins, onProgress) {
  state = "running";
  const results = [];

  for (let i = 0; i < gstins.length; i++) {
    const gstin = gstins[i].trim().toUpperCase();

    // Validate format
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

    // Tell frontend: "type this GSTIN"
    onProgress({ type: "typing", index: i, total: gstins.length, gstin });

    try {
      await typeGSTIN(gstin);
    } catch (e) {
      const r = { gstin, status: "Error", legalName: "-", tradeName: "-",
                  registrationDate: "-", gstnType: "-",
                  stateCode: gstin.substring(0, 2), error: "Could not type GSTIN: " + e.message };
      results.push(r);
      onProgress({ type: "result", index: i, total: gstins.length, result: r });
      continue;
    }

    // Tell frontend: "waiting for user to solve captcha and click Search"
    onProgress({ type: "waiting_captcha", index: i, total: gstins.length, gstin });

    // Wait for result (user solves captcha + clicks Search)
    const result = await waitForResult(gstin);
    results.push(result);
    onProgress({ type: "result", index: i, total: gstins.length, result });

    // Small pause before next
    if (i < gstins.length - 1) {
      onProgress({ type: "next_in", index: i, total: gstins.length, gstin: gstins[i + 1] });
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  state = "done";
  onProgress({ type: "done", total: gstins.length, results });
  return results;
}

async function closeBrowser() {
  if (browser) {
    try { await browser.close(); } catch (_) {}
    browser = null;
    page    = null;
    state   = "idle";
  }
}

function getState() { return state; }

module.exports = { launch, waitForLogin, typeGSTIN, waitForResult, runBatch, closeBrowser, getState };
