// Runs the real server.js on a free port; `npm test`.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHEET = "https://script.google.com/macros/s/TEST_DEPLOYMENT/exec";
let nextPort = 4600 + Math.floor(Math.random() * 300);

async function startServer(env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "baraq-site-"));
  const port = nextPort++;
  const log = path.join(dir, "sheet.log");
  const child = spawn(process.execPath, ["--import", "./tests/mock-sheet.mjs", "server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      BARAQ_WAITLIST_FILE: path.join(dir, "waitlist.json"),
      MOCK_SHEET_LOG: log,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) resolve(); });
    child.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  const calls = () => (existsSync(log)
    ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : []);
  return { base, calls, stop: () => child.kill() };
}

const join = (base, headers = {}) => fetch(`${base}/api/v1/waitlist/sheet/?action=join`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", ...headers },
  body: new URLSearchParams({ email: "a@example.com", full_name: "طالب", phone: "+963912345678", locale: "ar", company: "" }).toString()
});

describe("pages", () => {
  let site;
  before(async () => { site = await startServer(); });
  after(() => site.stop());

  it("sends a Content-Security-Policy on every HTML page and only there", async () => {
    for (const page of ["/ar/", "/en/", "/links", "/ar/privacy/", "/does-not-exist"]) {
      const response = await fetch(site.base + page);
      const csp = response.headers.get("content-security-policy") || "";
      assert.match(csp, /frame-ancestors 'none'/, page);
      assert.match(csp, /connect-src 'self' https:\/\/script\.google\.com https:\/\/script\.googleusercontent\.com/, page);
      assert.match(csp, /font-src 'self' https:\/\/fonts\.gstatic\.com/, page);
    }
    const js = await fetch(`${site.base}/js/main.js`);
    assert.equal(js.headers.get("content-security-policy"), null);
  });

  it("serves /favicon.ico as an icon", async () => {
    const response = await fetch(`${site.base}/favicon.ico`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/x-icon");
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 4)], [0, 0, 1, 0]); // ICO magic
  });

  it("gives /links a square logo file for its square slot", async () => {
    const html = await (await fetch(`${site.base}/links`)).text();
    assert.match(html, /class="links-logo" src="\/assets\/logo\/icon-square\.webp"/);
    const bytes = new Uint8Array(await (await fetch(`${site.base}/assets/logo/icon-square.webp`)).arrayBuffer());
    // WebP VP8X canvas size: width-1 / height-1 as 24-bit little endian at 24 / 27.
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    assert.equal(width, height);
  });

  it("does not publish the Apps Script source or the tests", async () => {
    assert.equal((await fetch(`${site.base}/apps-script/Code.gs`)).status, 404);
    assert.equal((await fetch(`${site.base}/tests/server.test.mjs`)).status, 404);
  });
});

describe("waitlist relay disabled (no BARAQ_WAITLIST_SHEET_URL)", () => {
  let site;
  before(async () => { site = await startServer(); });
  after(() => site.stop());

  it("answers 404/405 so the browser falls back to Apps Script directly", async () => {
    assert.equal((await fetch(`${site.base}/api/v1/waitlist/sheet/?action=count`)).status, 404);
    assert.equal((await join(site.base)).status, 405);
    assert.deepEqual(site.calls(), []);
  });
});

describe("waitlist relay enabled", () => {
  let site;
  before(async () => { site = await startServer({ BARAQ_WAITLIST_SHEET_URL: SHEET }); });
  after(() => site.stop());

  it("relays the count and caches it briefly", async () => {
    const first = await fetch(`${site.base}/api/v1/waitlist/sheet/?action=count`);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true, count: 19 });
    await fetch(`${site.base}/api/v1/waitlist/sheet/?action=count`);
    const counts = site.calls().filter((call) => call.action === "count");
    assert.equal(counts.length, 1);
    assert.equal(counts[0].host, "script.google.com");
  });

  it("relays a join as the same form POST, following Apps Script's redirect", async () => {
    const response = await join(site.base, { "X-Forwarded-For": "203.0.113.5" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, created: true, count: 20 });
    const call = site.calls().find((entry) => entry.action === "join");
    assert.equal(call.method, "POST");
    assert.equal(call.redirect, "follow");
    assert.match(call.contentType, /application\/x-www-form-urlencoded/);
    const form = new URLSearchParams(call.body);
    assert.equal(form.get("phone"), "+963912345678");
    assert.equal(form.get("full_name"), "طالب");
  });

  it("rate-limits per visitor behind the proxy, not for everyone at once", async () => {
    let status;
    for (let i = 0; i < 9; i += 1) status = (await join(site.base, { "X-Forwarded-For": "198.51.100.7" })).status;
    assert.equal(status, 429);
    assert.equal((await join(site.base, { "X-Forwarded-For": "198.51.100.8" })).status, 200);
  });

  it("rejects other methods and actions", async () => {
    assert.equal((await fetch(`${site.base}/api/v1/waitlist/sheet/?action=join`)).status, 405);
    assert.equal((await fetch(`${site.base}/api/v1/waitlist/sheet/?action=list`)).status, 405);
  });
});

describe("waitlist relay upstream failures", () => {
  it("answers 502 when Apps Script is unreachable", async () => {
    const site = await startServer({ BARAQ_WAITLIST_SHEET_URL: SHEET, MOCK_SHEET_MODE: "down" });
    try {
      assert.equal((await fetch(`${site.base}/api/v1/waitlist/sheet/?action=count`)).status, 502);
      assert.equal((await join(site.base)).status, 502);
    } finally { site.stop(); }
  });

  it("retries a count once when Google answers an HTML 404", async () => {
    const site = await startServer({ BARAQ_WAITLIST_SHEET_URL: SHEET, MOCK_SHEET_MODE: "flaky-count" });
    try {
      const response = await fetch(`${site.base}/api/v1/waitlist/sheet/?action=count`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, count: 19 });
      assert.equal(site.calls().filter((call) => call.action === "count").length, 2);
    } finally { site.stop(); }
  });

  it("never relays a non-JSON answer (e.g. a Google login page)", async () => {
    const site = await startServer({ BARAQ_WAITLIST_SHEET_URL: SHEET, MOCK_SHEET_MODE: "html" });
    try {
      assert.equal((await fetch(`${site.base}/api/v1/waitlist/sheet/?action=count`)).status, 502);
    } finally { site.stop(); }
  });

  it("ignores a relay URL that is not Apps Script", async () => {
    const site = await startServer({ BARAQ_WAITLIST_SHEET_URL: "https://evil.example/exec" });
    try {
      assert.equal((await fetch(`${site.base}/api/v1/waitlist/sheet/?action=count`)).status, 404);
      assert.deepEqual(site.calls(), []);
    } finally { site.stop(); }
  });
});
