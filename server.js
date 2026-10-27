import { createServer } from "node:http";
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants, createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, timingSafeEqual } from "node:crypto";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const waitlistFile = process.env.BARAQ_WAITLIST_FILE
  ? path.resolve(process.env.BARAQ_WAITLIST_FILE)
  : path.join(rootDirectory, "data", "waitlist.json");
const dataDirectory = path.dirname(waitlistFile);
const port = Number.parseInt(process.env.PORT || "4173", 10);
const host = process.env.HOST || "127.0.0.1";
const maximumBodyBytes = 16 * 1024;
const adminUsername = process.env.WAITLIST_ADMIN_USERNAME || "";
const adminPassword = process.env.WAITLIST_ADMIN_PASSWORD || "";
const linksTemplateFile = path.join(rootDirectory, "links", "index.html");
const linksPlaceholder = "<!--BARAQ_LINKS-->";

// The production waitlist lives in a Google Sheet behind Apps Script. When
// this is set, /api/v1/waitlist/sheet/ relays the browser's count/join calls
// to it from this server, so visitors whose network or blocker stops
// script.google.com can still sign up. js/main.js falls back to calling Apps
// Script directly when the relay is absent, so leaving it unset changes nothing.
const waitlistSheetUrl = (() => {
  const raw = (process.env.BARAQ_WAITLIST_SHEET_URL || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && url.hostname === "script.google.com") return url.toString();
  } catch {}
  console.warn("Ignoring BARAQ_WAITLIST_SHEET_URL: must be an https://script.google.com/ URL");
  return "";
})();
const sheetTimeoutMilliseconds = 15000;
const sheetCountCacheMilliseconds = 30000;
let sheetCountCache = { at: 0, body: "" };

// Every HTML page. Inline scripts/style attributes exist in the pages, so
// 'unsafe-inline' stays (same stance as the web app); the rest pins every
// origin the site actually uses: Google Fonts, and Apps Script (which
// answers through a redirect to script.googleusercontent.com).
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://script.google.com https://script.googleusercontent.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

function pageHeaders(contentType) {
  return String(contentType).startsWith("text/html")
    ? { "Content-Security-Policy": contentSecurityPolicy }
    : {};
}

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"]
]);

await mkdir(dataDirectory, { recursive: true });
try {
  await access(waitlistFile, fsConstants.F_OK);
} catch {
  await writeFile(waitlistFile, "[]\n", "utf8");
}

let entries = await loadEntries();
let writeQueue = Promise.resolve();
const rateLimits = new Map();

async function loadEntries() {
  const parsed = JSON.parse(await readFile(waitlistFile, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("data/waitlist.json must contain a JSON array");
  return parsed;
}

async function persistEntries(nextEntries) {
  const temporaryFile = `${waitlistFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(nextEntries, null, 2)}\n`, "utf8");
  await rename(temporaryFile, waitlistFile);
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

function sendText(response, statusCode, body, contentType, headers = {}) {
  response.writeHead(statusCode, { "Content-Type": contentType, "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...pageHeaders(contentType), ...headers });
  response.end(body);
}

function safeEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function hasAdminAccess(request) {
  if (!adminUsername || !adminPassword) return false;
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const divider = decoded.indexOf(":");
    return divider >= 0 && safeEqual(decoded.slice(0, divider), adminUsername) && safeEqual(decoded.slice(divider + 1), adminPassword);
  } catch { return false; }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function escapeCsv(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

function renderAdminPage() {
  const rows = entries.slice().reverse().map((entry, index) => `<tr><td>${entries.length - index}</td><td>${escapeHtml(entry.full_name)}</td><td><a href="mailto:${escapeHtml(entry.email)}">${escapeHtml(entry.email)}</a></td><td dir="ltr">${entry.phone ? `<a href="https://wa.me/${escapeHtml(entry.phone.replace(/^\+/, ""))}" rel="noopener noreferrer" target="_blank">${escapeHtml(entry.phone)}</a>` : ""}</td><td>${escapeHtml(entry.locale)}</td><td>${escapeHtml(entry.source)}</td><td>${escapeHtml(entry.joined_at)}</td></tr>`).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Barraq | قائمة الانتظار الخاصة</title><style>body{margin:0;background:#080d20;color:#edf1ff;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1100px;margin:48px auto;padding:0 20px}h1{margin:0 0 6px}.card{background:#121a34;border:1px solid #2c3965;border-radius:18px;padding:24px;overflow:auto}.meta{color:#bdc8eb;margin:0 0 24px}.download{display:inline-block;margin-bottom:18px;padding:10px 16px;border-radius:10px;background:#f5b947;color:#17101f;text-decoration:none;font-weight:700}table{width:100%;border-collapse:collapse;min-width:760px}th,td{padding:12px;text-align:right;border-bottom:1px solid #2c3965}th{color:#f5c86c}a{color:#a9c8ff}.empty{color:#bdc8eb}</style></head><body><main><h1>قائمة انتظار برّاق الخاصة</h1><p class="meta">${entries.length} سجلًا محفوظًا محليًا. هذه الصفحة لا تُفهرس ولا تظهر بدون بيانات الدخول.</p><section class="card"><a class="download" href="/admin/waitlist.csv">تنزيل CSV</a>${rows ? `<table><thead><tr><th>#</th><th>الاسم</th><th>البريد الإلكتروني</th><th>واتساب</th><th>اللغة</th><th>المصدر</th><th>وقت الانضمام (UTC)</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty">لا توجد طلبات مسجلة بعد.</p>'}</section></main></body></html>`;
}

async function handleAdmin(request, response, pathname) {
  if (!["/admin/waitlist", "/admin/waitlist/", "/admin/waitlist.csv"].includes(pathname)) return false;
  if (!adminUsername || !adminPassword) { await serveNotFound(request, response); return true; }
  if (!hasAdminAccess(request)) { sendText(response, 401, "Authentication required", "text/plain; charset=utf-8", { "WWW-Authenticate": 'Basic realm="Barraq owner area", charset="UTF-8"' }); return true; }
  if (request.method !== "GET" && request.method !== "HEAD") { sendJson(response, 405, { error: "Method not allowed" }); return true; }
  if (pathname === "/admin/waitlist.csv") {
    // "whatsapp" is the last column so existing CSV consumers keep their column order.
    const csv = ["position,full_name,email,locale,source,joined_at,whatsapp", ...entries.map((entry, index) => [entries.length - index, entry.full_name, entry.email, entry.locale, entry.source, entry.joined_at, entry.phone || ""].map(escapeCsv).join(","))].join("\n");
    if (request.method === "HEAD") response.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" }).end();
    else sendText(response, 200, `\uFEFF${csv}\n`, "text/csv; charset=utf-8", { "Content-Disposition": 'attachment; filename="barraq-waitlist.csv"' });
    return true;
  }
  const page = renderAdminPage();
  if (request.method === "HEAD") response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...pageHeaders("text/html") }).end();
  else sendText(response, 200, page, "text/html; charset=utf-8");
  return true;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let receivedBytes = 0;

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      receivedBytes += Buffer.byteLength(chunk);
      if (receivedBytes > maximumBodyBytes) {
        reject(Object.assign(new Error("Request body is too large"), { statusCode: 413 }));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Must stay in sync with normalizePhone() in js/main.js and apps-script/Code.gs.
function normalizePhone(value) {
  let cleaned = String(value || "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\s\-().‎‏‪-‮]/g, "");
  if (cleaned.startsWith("00")) cleaned = `+${cleaned.slice(2)}`;
  return cleaned;
}

function isValidPhone(phone) {
  return /^\+?[0-9]{8,15}$/.test(phone);
}

function isPrivateAddress(address) {
  const value = String(address || "").replace(/^::ffff:/, "");
  return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(value)
    || value === "::1" || /^f[cd]/i.test(value);
}

// Behind Caddy every request arrives from Caddy's address, so limiting by the
// socket alone made all visitors share one bucket. X-Forwarded-For is only
// trusted when the peer is on the private network (i.e. the proxy).
function clientAddress(request) {
  const peer = request.socket.remoteAddress || "unknown";
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded && isPrivateAddress(peer) ? forwarded : peer;
}

function isRateLimited(request) {
  const address = clientAddress(request);
  const now = Date.now();
  const windowMilliseconds = 10 * 60 * 1000;
  const current = rateLimits.get(address);

  if (!current || now - current.startedAt > windowMilliseconds) {
    rateLimits.set(address, { startedAt: now, count: 1 });
    return false;
  }

  current.count += 1;
  return current.count > 8;
}

async function readRawBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBodyBytes) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendSheetJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

async function callSheet(action, init = {}) {
  const url = new URL(waitlistSheetUrl);
  url.searchParams.set("action", action);
  // Apps Script answers a POST with a 302 to script.googleusercontent.com,
  // which must be fetched with GET -- exactly what fetch's redirect does.
  const upstream = await fetch(url, {
    ...init,
    redirect: "follow",
    headers: { Accept: "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(sheetTimeoutMilliseconds)
  });
  const body = await upstream.text();
  JSON.parse(body); // relay only well-formed JSON; anything else is a 502
  return body;
}

async function handleSheetRelay(request, response, pathname, searchParams) {
  if (pathname !== "/api/v1/waitlist/sheet/" || !waitlistSheetUrl) return false;
  const action = searchParams.get("action");
  try {
    if (request.method === "GET" && action === "count") {
      if (!sheetCountCache.body || Date.now() - sheetCountCache.at > sheetCountCacheMilliseconds) {
        // Read-only, so one retry: Google's googleusercontent redirect
        // intermittently answers an HTML 404 for a perfectly good script.
        const body = await callSheet("count").catch(() => callSheet("count"));
        sheetCountCache = { at: Date.now(), body };
      }
      sendSheetJson(response, 200, sheetCountCache.body);
      return true;
    }
    if (request.method === "POST" && action === "join") {
      if (isRateLimited(request)) {
        sendSheetJson(response, 429, JSON.stringify({ ok: false, error: "rate_limited" }));
        return true;
      }
      const form = await readRawBody(request);
      const body = await callSheet("join", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: form
      });
      sheetCountCache = { at: 0, body: "" };
      sendSheetJson(response, 200, body);
      return true;
    }
    sendSheetJson(response, 405, JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return true;
  } catch {
    sendSheetJson(response, 502, JSON.stringify({ ok: false, error: "sheet_unavailable" }));
    return true;
  }
}

async function handleWaitlist(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/v1/waitlist/count/") {
    sendJson(response, 200, { count: entries.length });
    return true;
  }

  if (request.method !== "POST" || pathname !== "/api/v1/waitlist/") return false;

  if (isRateLimited(request)) {
    sendJson(response, 429, { error: "Too many requests. Please try again later." });
    return true;
  }

  try {
    const payload = await readJsonBody(request);
    const fullName = String(payload.full_name || "").trim().replace(/\s+/g, " ");
    const email = String(payload.email || "").trim().toLowerCase();
    const locale = payload.locale === "en" ? "en" : "ar";

    // Honeypot submissions receive a neutral response but are never stored.
    if (String(payload.company || "").trim()) {
      sendJson(response, 201, { created: true, count: entries.length });
      return true;
    }

    if (fullName.length < 2 || fullName.length > 100 || !isValidEmail(email)) {
      sendJson(response, 400, { error: "Please provide a valid name and email address." });
      return true;
    }
    const phone = normalizePhone(payload.phone);
    if (phone && !isValidPhone(phone)) {
      sendJson(response, 400, { error: "Please provide a valid WhatsApp number." });
      return true;
    }

    const operation = writeQueue.then(async () => {
      const existing = entries.find((entry) => entry.email === email);
      if (existing) {
        // Fill a missing number for someone already on the list; never overwrite.
        if (phone && !existing.phone) {
          const nextEntries = entries.map((entry) => (entry === existing ? { ...entry, phone } : entry));
          await persistEntries(nextEntries);
          entries = nextEntries;
        }
        return { created: false, count: entries.length };
      }

      const nextEntry = {
        id: randomUUID(),
        full_name: fullName,
        email,
        phone,
        locale,
        source: "website",
        joined_at: new Date().toISOString()
      };
      const nextEntries = [...entries, nextEntry];
      await persistEntries(nextEntries);
      entries = nextEntries;
      return { created: true, count: entries.length };
    });

    writeQueue = operation.catch(() => {});
    const result = await operation;
    sendJson(response, result.created ? 201 : 200, result);
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.statusCode ? error.message : "Unable to save the waitlist entry."
    });
  }
  return true;
}

// ---------- /links: QR-code landing page ----------
// Every URL comes from the environment so the team can change a handle
// without a code change. A link with no value is simply not rendered.
const linkIcons = {
  app: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 1.9 1.7.7-1.7.7L19 20l-.8-1.9-1.7-.7 1.7-.7z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M5 18v1.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V18"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.6 21v-7.2h2.4l.4-2.9h-2.8V9.1c0-.8.3-1.4 1.4-1.4h1.5V5.1c-.3 0-1.2-.1-2.2-.1-2.2 0-3.6 1.3-3.6 3.8v2.1H8.3v2.9h2.4V21z"/></svg>',
  telegram: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.7 4.1 2.9 11c-1.2.5-1.2 1.2-.2 1.5l4.6 1.4 1.8 5.4c.2.6.4.8.9.8.4 0 .6-.2.9-.4l2.2-2.1 4.6 3.4c.8.5 1.4.2 1.6-.8l3-14.1c.3-1.2-.4-1.8-1.6-1.3zM9.6 14.2l8.2-7.4c.4-.3-.1-.5-.6-.2l-10.1 6.4 4.4 1.4-.4 3.7z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4v11H3zM9.5 9.75h3.8v1.6c.6-1 1.9-1.9 3.8-1.9 3.4 0 4.4 2.1 4.4 5.2v6.1h-4v-5.4c0-1.4-.3-2.6-1.8-2.6-1.6 0-2.2 1.1-2.2 2.6v5.4h-4z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></svg>'
};

const linkSpecs = [
  { variant: "app", env: "BARAQ_LINK_WEB_APP_URL", fallback: "https://web.baraqapp.com", icon: "app", ar: "افتح تطبيق برّاق", en: "Open the Barraq web app", external: false },
  { variant: "download", env: "BARAQ_LINK_DOWNLOAD_URL", fallback: "https://baraqapp.com/download/", icon: "download", ar: "حمّل تطبيق أندرويد", en: "Download the Android app", external: false },
  { variant: "website", env: "BARAQ_LINK_WEBSITE_URL", fallback: "https://baraqapp.com", icon: "globe", ar: "الموقع الرسمي", en: "Official website", external: false },
  { variant: "instagram", env: "BARAQ_LINK_INSTAGRAM_URL", icon: "instagram", ar: "إنستغرام", en: "Instagram", external: true },
  { variant: "facebook", env: "BARAQ_LINK_FACEBOOK_URL", icon: "facebook", ar: "فيسبوك", en: "Facebook", external: true },
  { variant: "telegram", env: "BARAQ_LINK_TELEGRAM_URL", icon: "telegram", ar: "قناة تيليجرام", en: "Telegram channel", external: true },
  { variant: "linkedin", env: "BARAQ_LINK_LINKEDIN_URL", icon: "linkedin", ar: "لينكدإن", en: "LinkedIn", external: true },
  { variant: "email", env: "BARAQ_LINK_EMAIL", icon: "mail", ar: "راسلنا عبر البريد", en: "Email us", email: true }
];

function resolveLinkHref(spec) {
  const raw = String(process.env[spec.env] || spec.fallback || "").trim();
  if (!raw) return "";
  if (spec.email) {
    const address = raw.replace(/^mailto:/i, "");
    if (isValidEmail(address)) return `mailto:${address}`;
  } else {
    try {
      // https only: a typo in the environment must never become a
      // javascript: or data: link on a page people reach by scanning a QR.
      if (new URL(raw).protocol === "https:") return raw;
    } catch { /* reported below */ }
  }
  console.warn(`Ignoring ${spec.env}: expected ${spec.email ? "an email address" : "an https:// URL"}.`);
  return "";
}

const siteLinks = linkSpecs.map((spec) => ({ ...spec, href: resolveLinkHref(spec) })).filter((link) => link.href);

function renderLinkButtons() {
  return siteLinks.map((link, index) => {
    const target = link.external ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a class="link-btn link-btn--${link.variant}" href="${escapeHtml(link.href)}"${target} style="--i:${index}">`
      + `<span class="link-icon" aria-hidden="true">${linkIcons[link.icon]}</span>`
      + `<span class="link-text"><span class="link-ar">${escapeHtml(link.ar)}</span><span class="link-en" lang="en" dir="ltr">${escapeHtml(link.en)}</span></span>`
      + '<span class="link-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></span>'
      + "</a>";
  }).join("\n      ");
}

async function handleLinks(request, response, pathname) {
  if (!["/links", "/links/", "/links/index.html"].includes(pathname)) return false;
  if (request.method !== "GET" && request.method !== "HEAD") { sendJson(response, 405, { error: "Method not allowed" }); return true; }
  const template = await readFile(linksTemplateFile, "utf8");
  const page = template.replace(linksPlaceholder, renderLinkButtons());
  if (request.method === "HEAD") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", ...pageHeaders("text/html") }).end();
  } else {
    sendText(response, 200, page, "text/html; charset=utf-8", { "Cache-Control": "no-cache", "Referrer-Policy": "strict-origin-when-cross-origin" });
  }
  return true;
}

// ---------- Android app downloads ----------
// The app is distributed as a signed APK from this site (not from a store).
// Files live outside the image, in BARAQ_DOWNLOADS_DIR/android/, so shipping a
// new version is "copy two files", never a redeploy:
//   baraq-<x.y.z>.apk   the signed universal APK
//   latest.json         written by scripts/android-release.mjs in the app repo
// Nothing here trusts the manifest blindly: every field is validated, the file
// name must be the versioned pattern, and the size on disk must match, so a
// half-copied upload never produces a download button.
const downloadsDirectory = path.resolve(process.env.BARAQ_DOWNLOADS_DIR || path.join(rootDirectory, "downloads"));
const androidDirectory = path.join(downloadsDirectory, "android");
const apkNamePattern = /^baraq-(\d+)\.(\d+)\.(\d+)\.apk$/;
const downloadPlaceholder = "<!--BARAQ_DOWNLOAD-->";
const downloadLocales = new Set(["ar", "en"]);
const apkContentType = "application/vnd.android.package-archive";

async function loadAndroidRelease() {
  try {
    const raw = JSON.parse(await readFile(path.join(androidDirectory, "latest.json"), "utf8"));
    const name = String(raw.file || "");
    const match = apkNamePattern.exec(name);
    const hex64 = /^[0-9a-f]{64}$/;
    const releasedAt = new Date(raw.releasedAt);
    if (!match
      || raw.versionName !== `${match[1]}.${match[2]}.${match[3]}`
      || raw.applicationId !== "com.baraq.app"
      || !Number.isInteger(raw.versionCode) || raw.versionCode < 1
      || !Number.isInteger(raw.sizeBytes) || raw.sizeBytes < 1
      || !hex64.test(String(raw.sha256)) || !hex64.test(String(raw.signingCertSha256))
      || !/^\d+(\.\d+)*$/.test(String(raw.minAndroid))
      || Number.isNaN(releasedAt.getTime())) return null;
    const onDisk = await stat(path.join(androidDirectory, name));
    if (!onDisk.isFile() || onDisk.size !== raw.sizeBytes) return null;
    return {
      file: name, versionName: raw.versionName, versionCode: raw.versionCode, sizeBytes: raw.sizeBytes,
      sha256: raw.sha256, signingCertSha256: raw.signingCertSha256, minAndroid: String(raw.minAndroid), releasedAt
    };
  } catch { return null; }
}

const formatFingerprint = (hex) => hex.toUpperCase().match(/.{2}/g).join(":");

const downloadText = {
  ar: {
    button: "تنزيل برّاق لأندرويد", version: "الإصدار", size: "الحجم", date: "تاريخ الإصدار", requires: "يتطلب",
    requiresValue: (v) => `أندرويد ${v} أو أحدث`, checksum: "بصمة الملف (SHA-256)", cert: "بصمة شهادة التوقيع (SHA-256)",
    copy: "نسخ", copied: "تم النسخ", mb: "ميغابايت", qrTitle: "افتحه من هاتفك", qrBody: "امسح الرمز بكاميرا هاتفك لتنزيل التطبيق مباشرة.",
    soonTitle: "نسخة أندرويد قيد الإعداد", soonBody: "لم يُنشر ملف التطبيق بعد. انضم إلى قائمة الانتظار وسنخبرك فور توفره.", soonCta: "انضم لقائمة الانتظار",
    locale: "ar-EG-u-nu-latn"
  },
  en: {
    button: "Download Barraq for Android", version: "Version", size: "Size", date: "Released", requires: "Requires",
    requiresValue: (v) => `Android ${v} or newer`, checksum: "File fingerprint (SHA-256)", cert: "Signing certificate fingerprint (SHA-256)",
    copy: "Copy", copied: "Copied", mb: "MB", qrTitle: "Open it on your phone", qrBody: "Scan the code with your phone's camera to download the app directly.",
    soonTitle: "The Android app is being prepared", soonBody: "The app file has not been published yet. Join the waitlist and we will tell you as soon as it is available.", soonCta: "Join the waitlist",
    locale: "en-GB"
  }
};

function renderDownloadCard(locale, release) {
  const t = downloadText[locale];
  if (!release) {
    return `<section class="dl-card dl-card--soon" aria-labelledby="dl-soon"><h2 id="dl-soon">${t.soonTitle}</h2><p>${t.soonBody}</p><a class="btn btn-primary" href="/${locale}/#waitlist">${t.soonCta}</a></section>`;
  }
  const size = (release.sizeBytes / 1048576).toFixed(1);
  const date = release.releasedAt.toLocaleDateString(t.locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const href = `/downloads/android/${release.file}`;
  const ld = JSON.stringify({
    "@context": "https://schema.org", "@type": "SoftwareApplication", name: "برّاق / Barraq",
    operatingSystem: `Android ${release.minAndroid}+`, applicationCategory: "EducationalApplication",
    softwareVersion: release.versionName, fileSize: `${size}MB`, downloadUrl: `https://baraqapp.com${href}`,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }
  }).replaceAll("<", "\\u003c");
  return `<section class="dl-card" aria-label="${t.button}">
    <div class="dl-main">
      <a class="btn btn-primary dl-btn" href="${escapeHtml(href)}" download>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17"/></svg>
        <span>${t.button}</span>
      </a>
      <dl class="dl-facts">
        <div><dt>${t.version}</dt><dd dir="ltr">${escapeHtml(release.versionName)}</dd></div>
        <div><dt>${t.size}</dt><dd>${size} ${t.mb}</dd></div>
        <div><dt>${t.date}</dt><dd>${escapeHtml(date)}</dd></div>
        <div><dt>${t.requires}</dt><dd>${escapeHtml(t.requiresValue(release.minAndroid))}</dd></div>
      </dl>
      <div class="dl-hash">
        <p class="dl-hash-label">${t.checksum}</p>
        <div class="dl-hash-row"><code dir="ltr" id="dlSha">${release.sha256}</code><button type="button" class="dl-copy" data-copy="dlSha" data-copied="${t.copied}">${t.copy}</button></div>
        <p class="dl-hash-label">${t.cert}</p>
        <div class="dl-hash-row"><code dir="ltr" id="dlCert">${formatFingerprint(release.signingCertSha256)}</code><button type="button" class="dl-copy" data-copy="dlCert" data-copied="${t.copied}">${t.copy}</button></div>
      </div>
    </div>
    <aside class="dl-qr" aria-label="${t.qrTitle}">
      <img src="/assets/download/qr-android.svg" width="168" height="168" alt="QR">
      <strong>${t.qrTitle}</strong>
      <span>${t.qrBody}</span>
    </aside>
    <script type="application/ld+json">${ld}</script>
  </section>`;
}

function sendRedirect(response, location, statusCode = 302) {
  response.writeHead(statusCode, { Location: location, "Cache-Control": "no-cache", "Content-Length": 0 });
  response.end();
}

// Single byte range, the only kind browsers and download managers send; it is
// what lets a download on a flaky mobile connection resume instead of restart.
function parseByteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start; let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(size - suffix, 0); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start > end || start >= size ? "unsatisfiable" : { start, end };
}

async function sendDownloadFile(request, response, filePath, { contentType, fileName, etag, attachment }) {
  const { size } = await stat(filePath);
  const headers = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    ...(attachment ? { "Content-Disposition": `attachment; filename="${fileName}"` } : {}),
    ...(etag ? { ETag: etag } : {})
  };
  const ifRange = request.headers["if-range"];
  const range = ifRange && ifRange !== etag ? null : parseByteRange(request.headers.range, size);
  if (range === "unsatisfiable") {
    response.writeHead(416, { ...headers, "Content-Range": `bytes */${size}`, "Content-Length": 0 });
    response.end();
    return;
  }
  const partial = range !== null;
  const { start, end } = partial ? range : { start: 0, end: size - 1 };
  response.writeHead(partial ? 206 : 200, {
    ...headers,
    "Content-Length": end - start + 1,
    ...(partial ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {})
  });
  if (request.method === "HEAD") { response.end(); return; }
  if (start === 0) console.log(JSON.stringify({ event: "android_download", file: fileName, partial }));
  createReadStream(filePath, { start, end }).pipe(response);
}

async function handleDownloads(request, response, pathname) {
  const isDownloadPage = ["/download", "/download/", "/download/android", "/ar/download", "/ar/download/", "/en/download", "/en/download/"].includes(pathname);
  const isFile = pathname.startsWith("/downloads/android/");
  if (!isDownloadPage && !isFile) return false;
  if (request.method !== "GET" && request.method !== "HEAD") { sendJson(response, 405, { error: "Method not allowed" }); return true; }

  if (pathname === "/download" || pathname === "/download/") {
    const preferred = String(request.headers["accept-language"] || "").toLowerCase().startsWith("en") ? "en" : "ar";
    sendRedirect(response, `/${preferred}/download/`);
    return true;
  }
  if (pathname === "/ar/download" || pathname === "/en/download") { sendRedirect(response, `${pathname}/`, 301); return true; }

  const release = await loadAndroidRelease();

  if (pathname === "/download/android") {
    if (!release) { await serveNotFound(request, response); return true; }
    sendRedirect(response, `/downloads/android/${release.file}`);
    return true;
  }

  if (isDownloadPage) {
    const locale = pathname.slice(1, 3);
    const template = await readFile(path.join(rootDirectory, locale, "download", "index.html"), "utf8");
    const page = template.replace(downloadPlaceholder, renderDownloadCard(locale, release));
    if (request.method === "HEAD") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", ...pageHeaders("text/html") }).end();
    } else {
      sendText(response, 200, page, "text/html; charset=utf-8", { "Cache-Control": "no-cache", "Referrer-Policy": "strict-origin-when-cross-origin" });
    }
    return true;
  }

  const name = pathname.slice("/downloads/android/".length);
  if (name === "latest.json") {
    if (!release) { await serveNotFound(request, response); return true; }
    const body = JSON.stringify({
      applicationId: "com.baraq.app", versionName: release.versionName, versionCode: release.versionCode, file: release.file,
      url: `https://baraqapp.com/downloads/android/${release.file}`, sizeBytes: release.sizeBytes, sha256: release.sha256,
      signingCertSha256: release.signingCertSha256, minAndroid: release.minAndroid, releasedAt: release.releasedAt.toISOString()
    });
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      // The app (served from https://localhost inside its WebView) may check for updates.
      "Access-Control-Allow-Origin": "https://localhost"
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return true;
  }

  const isChecksum = name.endsWith(".apk.sha256");
  const apkName = isChecksum ? name.slice(0, -".sha256".length) : name;
  // Only the versioned names, and only files that really exist: no traversal, no listing.
  if (!apkNamePattern.test(apkName)) { await serveNotFound(request, response); return true; }
  const filePath = path.join(androidDirectory, name);
  try { if (!(await stat(filePath)).isFile()) throw new Error("not a file"); } catch { await serveNotFound(request, response); return true; }
  await sendDownloadFile(request, response, filePath, isChecksum
    ? { contentType: "text/plain; charset=utf-8", fileName: name, attachment: false }
    : { contentType: apkContentType, fileName: name, attachment: true, etag: release && release.file === name ? `"${release.sha256}"` : undefined });
  return true;
}

function isPrivatePath(pathname) {
  const firstSegment = pathname.split("/").filter(Boolean)[0] || "";
  return firstSegment === "data"
    || firstSegment === "downloads"
    || firstSegment === "apps-script"
    || firstSegment === "tests"
    || firstSegment.startsWith(".")
    || ["server.js", "package.json", "package-lock.json", "README.md"].includes(firstSegment);
}

async function serveStatic(request, response, pathname) {
  if (!["GET", "HEAD"].includes(request.method)) {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  if (isPrivatePath(pathname)) {
    await serveNotFound(request, response);
    return;
  }

  let filePath = path.resolve(rootDirectory, `.${pathname}`);
  const rootPrefix = `${rootDirectory}${path.sep}`.toLowerCase();
  if (filePath !== rootDirectory && !filePath.toLowerCase().startsWith(rootPrefix)) {
    await serveNotFound(request, response);
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (fileStats.isDirectory()) filePath = path.join(filePath, "index.html");
    await access(filePath, fsConstants.R_OK);
  } catch {
    await serveNotFound(request, response);
    return;
  }

  await streamFile(request, response, filePath, 200);
}

async function serveNotFound(request, response) {
  await streamFile(request, response, path.join(rootDirectory, "404.html"), 404);
}

async function streamFile(request, response, filePath, statusCode) {
  const fileStats = await stat(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const cacheControl = extension === ".html" ? "no-cache" : "public, max-age=604800";
  const contentType = contentTypes.get(extension) || "application/octet-stream";
  response.writeHead(statusCode, {
    ...pageHeaders(contentType),
    "Content-Type": contentType,
    "Content-Length": fileStats.size,
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);
    if (await handleSheetRelay(request, response, pathname, url.searchParams)) return;
    if (await handleWaitlist(request, response, pathname)) return;
    if (await handleAdmin(request, response, pathname)) return;
    if (await handleLinks(request, response, pathname)) return;
    if (await handleDownloads(request, response, pathname)) return;
    await serveStatic(request, response, pathname);
  } catch {
    sendJson(response, 500, { error: "Internal server error" });
  }
});

server.listen(port, host, () => {
  console.log(`Barraq is running at http://${host}:${port}`);
  console.log(`Waitlist records: ${waitlistFile}`);
  console.log(`/links buttons: ${siteLinks.map((link) => link.variant).join(", ") || "none"}`);
  console.log(`Waitlist sheet relay: ${waitlistSheetUrl ? "on" : "off"}`);
});

