import { createServer } from "node:http";
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants, createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const waitlistFile = process.env.BARAQ_WAITLIST_FILE
  ? path.resolve(process.env.BARAQ_WAITLIST_FILE)
  : path.join(rootDirectory, "data", "waitlist.json");
const dataDirectory = path.dirname(waitlistFile);
const port = Number.parseInt(process.env.PORT || "4173", 10);
const host = process.env.HOST || "127.0.0.1";
const maximumBodyBytes = 16 * 1024;

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
    await serveStatic(request, response, pathname);
  } catch {
    sendJson(response, 500, { error: "Internal server error" });
  }
});

server.listen(port, host, () => {
  console.log(`Baraq is running at http://${host}:${port}`);
  console.log(`Waitlist records: ${waitlistFile}`);
});
