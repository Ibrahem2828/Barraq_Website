/**
 * Barraq waitlist Google Apps Script endpoint.
 *
 * Required Script Properties (Project settings > Script properties):
 *   SPREADSHEET_ID = the ID from the Google Sheet URL
 *   SHEET_NAME     = Waitlist
 */
// "whatsapp" is appended LAST on purpose: existing sheets keep their columns
// A-F untouched, and the duplicate check below still reads email from column C.
const HEADERS = ["id", "full_name", "email", "locale", "source", "joined_at", "whatsapp"];
const WHATSAPP_COLUMN = 7;

function doGet(event) {
  try {
    const action = String((event.parameter || {}).action || "health");
    if (action === "count") return json({ ok: true, count: getCount() });
    return json({ ok: true, service: "barraq-waitlist" });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: "Service configuration is incomplete." });
  }
}

function doPost(event) {
  try {
    const payload = event.parameter || {};
    if (String(payload.action || "") !== "join") return json({ ok: false, error: "Unsupported action." });

    // A hidden field that normal visitors never fill. Bot submissions are not stored.
    if (String(payload.company || "").trim()) return json({ ok: true, created: true, count: getCount() });

    const fullName = String(payload.full_name || "").trim().replace(/\s+/g, " ");
    const email = String(payload.email || "").trim().toLowerCase();
    const locale = payload.locale === "en" ? "en" : "ar";
    if (fullName.length < 2 || fullName.length > 100 || !isValidEmail(email)) {
      return json({ ok: false, error: "Please provide a valid name and email address." });
    }
    // Optional: older cached copies of the site's script never send it.
    const phone = normalizePhone(payload.phone);
    if (phone && !isValidPhone(phone)) {
      return json({ ok: false, error: "Please provide a valid WhatsApp number." });
    }
    // The leading apostrophe stores the number as text; otherwise Sheets
    // parses "+963..." as a number and drops the "+" (or goes scientific).
    const phoneCell = phone ? "'" + phone : "";

    const lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      const sheet = getSheet();
      const lastRow = sheet.getLastRow();
      const emails = lastRow > 1
        ? sheet.getRange(2, 3, lastRow - 1, 1).getDisplayValues().flat().map((value) => value.trim().toLowerCase())
        : [];
      const existingIndex = emails.indexOf(email);
      if (existingIndex !== -1) {
        // Someone already on the list can add a number later (e.g. after
        // scanning the QR code at an event). Never overwrite one that exists.
        if (phone) {
          const cell = sheet.getRange(existingIndex + 2, WHATSAPP_COLUMN);
          if (!cell.getDisplayValue().trim()) cell.setValue(phoneCell);
        }
        return json({ ok: true, created: false, count: emails.length });
      }

      sheet.appendRow([Utilities.getUuid(), fullName, email, locale, "website", new Date(), phoneCell]);
      return json({ ok: true, created: true, count: emails.length + 1 });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: "Unable to save the waitlist entry." });
  }
}

function getCount() {
  const lastRow = getSheet().getLastRow();
  return Math.max(0, lastRow - 1);
}

function getSheet() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty("SPREADSHEET_ID");
  const sheetName = properties.getProperty("SHEET_NAME");
  if (!spreadsheetId || !sheetName) throw new Error("Missing SPREADSHEET_ID or SHEET_NAME Script Property.");

  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
  if (!sheet) throw new Error("The configured sheet was not found.");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  } else if (sheet.getRange(1, 1).getDisplayValue() === "id" && !sheet.getRange(1, WHATSAPP_COLUMN).getDisplayValue()) {
    // Sheets created before the WhatsApp field: label the new column once.
    sheet.getRange(1, WHATSAPP_COLUMN).setValue("whatsapp");
  }
  return sheet;
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Must stay in sync with normalizePhone() in js/main.js and server.js.
function normalizePhone(value) {
  let cleaned = String(value || "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\s\-().‎‏‪-‮]/g, "");
  if (cleaned.startsWith("00")) cleaned = "+" + cleaned.slice(2);
  return cleaned;
}

function isValidPhone(phone) {
  return /^\+?[0-9]{8,15}$/.test(phone);
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
