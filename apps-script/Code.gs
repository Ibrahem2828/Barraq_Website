/**
 * Barraq waitlist Google Apps Script endpoint.
 *
 * Required Script Properties (Project settings > Script properties):
 *   SPREADSHEET_ID = the ID from the Google Sheet URL
 *   SHEET_NAME     = Waitlist
 */
const HEADERS = ["id", "full_name", "email", "locale", "source", "joined_at"];

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

    const lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      const sheet = getSheet();
      const lastRow = sheet.getLastRow();
      const emails = lastRow > 1
        ? sheet.getRange(2, 3, lastRow - 1, 1).getDisplayValues().flat().map((value) => value.trim().toLowerCase())
        : [];
      if (emails.includes(email)) return json({ ok: true, created: false, count: emails.length });

      sheet.appendRow([Utilities.getUuid(), fullName, email, locale, "website", new Date()]);
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
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  return sheet;
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
