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

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".png", "image/png"],
  [".webp", "image/webp"],
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
  response.writeHead(statusCode, { "Content-Type": contentType, "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
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
  const rows = entries.slice().reverse().map((entry, index) => `<tr><td>${entries.length - index}</td><td>${escapeHtml(entry.full_name)}</td><td><a href="mailto:${escapeHtml(entry.email)}">${escapeHtml(entry.email)}</a></td><td>${escapeHtml(entry.locale)}</td><td>${escapeHtml(entry.source)}</td><td>${escapeHtml(entry.joined_at)}</td></tr>`).join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Barraq | قائمة الانتظار الخاصة</title><style>body{margin:0;background:#080d20;color:#edf1ff;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1100px;margin:48px auto;padding:0 20px}h1{margin:0 0 6px}.card{background:#121a34;border:1px solid #2c3965;border-radius:18px;padding:24px;overflow:auto}.meta{color:#bdc8eb;margin:0 0 24px}.download{display:inline-block;margin-bottom:18px;padding:10px 16px;border-radius:10px;background:#f5b947;color:#17101f;text-decoration:none;font-weight:700}table{width:100%;border-collapse:collapse;min-width:760px}th,td{padding:12px;text-align:right;border-bottom:1px solid #2c3965}th{color:#f5c86c}a{color:#a9c8ff}.empty{color:#bdc8eb}</style></head><body><main><h1>قائمة انتظار برّاق الخاصة</h1><p class="meta">${entries.length} سجلًا محفوظًا محليًا. هذه الصفحة لا تُفهرس ولا تظهر بدون بيانات الدخول.</p><section class="card"><a class="download" href="/admin/waitlist.csv">تنزيل CSV</a>${rows ? `<table><thead><tr><th>#</th><th>الاسم</th><th>البريد الإلكتروني</th><th>اللغة</th><th>المصدر</th><th>وقت الانضمام (UTC)</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty">لا توجد طلبات مسجلة بعد.</p>'}</section></main></body></html>`;
}

async function handleAdmin(request, response, pathname) {
  if (!["/admin/waitlist", "/admin/waitlist/", "/admin/waitlist.csv"].includes(pathname)) return false;
  if (!adminUsername || !adminPassword) { await serveNotFound(request, response); return true; }
  if (!hasAdminAccess(request)) { sendText(response, 401, "Authentication required", "text/plain; charset=utf-8", { "WWW-Authenticate": 'Basic realm="Barraq owner area", charset="UTF-8"' }); return true; }
  if (request.method !== "GET" && request.method !== "HEAD") { sendJson(response, 405, { error: "Method not allowed" }); return true; }
  if (pathname === "/admin/waitlist.csv") {
    const csv = ["position,full_name,email,locale,source,joined_at", ...entries.map((entry, index) => [entries.length - index, entry.full_name, entry.email, entry.locale, entry.source, entry.joined_at].map(escapeCsv).join(","))].join("\n");
    if (request.method === "HEAD") response.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" }).end();
    else sendText(response, 200, `\uFEFF${csv}\n`, "text/csv; charset=utf-8", { "Content-Disposition": 'attachment; filename="barraq-waitlist.csv"' });
    return true;
  }
  const page = renderAdminPage();
  if (request.method === "HEAD") response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end();
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

function isRateLimited(request) {
  const address = request.socket.remoteAddress || "unknown";
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

    const operation = writeQueue.then(async () => {
      const existing = entries.find((entry) => entry.email === email);
      if (existing) return { created: false, count: entries.length };

      const nextEntry = {
        id: randomUUID(),
        full_name: fullName,
        email,
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

function isPrivatePath(pathname) {
  const firstSegment = pathname.split("/").filter(Boolean)[0] || "";
  return firstSegment === "data"
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
  response.writeHead(statusCode, {
    "Content-Type": contentTypes.get(extension) || "application/octet-stream",
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
    if (await handleWaitlist(request, response, pathname)) return;
    if (await handleAdmin(request, response, pathname)) return;
    await serveStatic(request, response, pathname);
  } catch {
    sendJson(response, 500, { error: "Internal server error" });
  }
});

server.listen(port, host, () => {
  console.log(`Barraq is running at http://${host}:${port}`);
  console.log(`Waitlist records: ${waitlistFile}`);
});

