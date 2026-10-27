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

// ---------- Android app downloads ----------
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

function makeRelease({ version = "1.0.0", bytes = Buffer.alloc(300_000, 7), manifest = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "baraq-dl-"));
  mkdirSync(path.join(dir, "android"), { recursive: true });
  const file = `baraq-${version}.apk`;
  writeFileSync(path.join(dir, "android", file), bytes);
  writeFileSync(path.join(dir, "android", `${file}.sha256`), `${createHash("sha256").update(bytes).digest("hex")}  ${file}\n`);
  const latest = {
    applicationId: "com.baraq.app", versionName: version, versionCode: 10000, file, sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), signingCertSha256: "3fc35383de0fb057ac0469eb528992022cecf86b60e348d1e908571beba0ea72",
    minAndroid: "7.0", minSdk: 24, releasedAt: "2026-10-27T12:22:54.622Z", ...manifest
  };
  writeFileSync(path.join(dir, "android", "latest.json"), JSON.stringify(latest));
  return { dir, file, bytes, latest };
}

describe("Android downloads: a published release", () => {
  let site; let release;
  before(async () => {
    release = makeRelease();
    site = await startServer({ BARAQ_DOWNLOADS_DIR: release.dir });
  });
  after(() => site.stop());

  it("renders the page in both languages with the file's real version, size and fingerprints", async () => {
    for (const [locale, word] of [["ar", "تنزيل برّاق لأندرويد"], ["en", "Download Barraq for Android"]]) {
      const response = await fetch(`${site.base}/${locale}/download/`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /text\/html/);
      assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
      const html = await response.text();
      assert.ok(html.includes(word), locale);
      assert.ok(html.includes(`/downloads/android/${release.file}`), locale);
      assert.ok(html.includes(release.latest.sha256), locale);
      assert.ok(html.includes("3F:C3:53:83:DE:0F:B0:57"), `${locale}: certificate fingerprint is shown with colons`);
      assert.ok(!html.includes("<!--BARAQ_DOWNLOAD-->"), locale);
      assert.match(html, /<script type="application\/ld\+json">/);
    }
  });

  it("serves the APK as a download with the right type, length and validators", async () => {
    const response = await fetch(`${site.base}/downloads/android/${release.file}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/vnd.android.package-archive");
    assert.equal(response.headers.get("content-disposition"), `attachment; filename="${release.file}"`);
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("etag"), `"${release.latest.sha256}"`);
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.length, release.bytes.length);
    assert.equal(createHash("sha256").update(body).digest("hex"), release.latest.sha256);
  });

  it("resumes an interrupted download: ranges reassemble to the identical file", async () => {
    const first = await fetch(`${site.base}/downloads/android/${release.file}`, { headers: { Range: "bytes=0-99999" } });
    assert.equal(first.status, 206);
    assert.equal(first.headers.get("content-range"), `bytes 0-99999/${release.bytes.length}`);
    const rest = await fetch(`${site.base}/downloads/android/${release.file}`, { headers: { Range: "bytes=100000-" } });
    assert.equal(rest.status, 206);
    const joined = Buffer.concat([Buffer.from(await first.arrayBuffer()), Buffer.from(await rest.arrayBuffer())]);
    assert.equal(createHash("sha256").update(joined).digest("hex"), release.latest.sha256);

    const tail = await fetch(`${site.base}/downloads/android/${release.file}`, { headers: { Range: "bytes=-10" } });
    assert.equal(tail.status, 206);
    assert.equal((await tail.arrayBuffer()).byteLength, 10);

    const beyond = await fetch(`${site.base}/downloads/android/${release.file}`, { headers: { Range: `bytes=${release.bytes.length + 5}-` } });
    assert.equal(beyond.status, 416);
    assert.equal(beyond.headers.get("content-range"), `bytes */${release.bytes.length}`);
  });

  it("ignores a stale If-Range validator and sends the whole file", async () => {
    const response = await fetch(`${site.base}/downloads/android/${release.file}`, { headers: { Range: "bytes=0-9", "If-Range": '"not-the-current-etag"' } });
    assert.equal(response.status, 200);
    assert.equal((await response.arrayBuffer()).byteLength, release.bytes.length);
  });

  it("answers HEAD without a body", async () => {
    const response = await fetch(`${site.base}/downloads/android/${release.file}`, { method: "HEAD" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-length"), String(release.bytes.length));
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });

  it("has stable short links: /download picks a language, /download/android goes to the newest APK", async () => {
    const arabic = await fetch(`${site.base}/download`, { redirect: "manual" });
    assert.equal(arabic.status, 302);
    assert.equal(arabic.headers.get("location"), "/ar/download/");
    const english = await fetch(`${site.base}/download/`, { redirect: "manual", headers: { "Accept-Language": "en-US,en;q=0.9" } });
    assert.equal(english.headers.get("location"), "/en/download/");
    const apk = await fetch(`${site.base}/download/android`, { redirect: "manual" });
    assert.equal(apk.status, 302);
    assert.equal(apk.headers.get("location"), `/downloads/android/${release.file}`);
    const slash = await fetch(`${site.base}/en/download`, { redirect: "manual" });
    assert.equal(slash.status, 301);
    assert.equal(slash.headers.get("location"), "/en/download/");
  });

  it("publishes the manifest for the app's update check, readable from the app's origin only", async () => {
    const response = await fetch(`${site.base}/downloads/android/latest.json`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://localhost");
    const manifest = await response.json();
    assert.equal(manifest.versionCode, 10000);
    assert.equal(manifest.sha256, release.latest.sha256);
    assert.equal(manifest.url, `https://baraqapp.com/downloads/android/${release.file}`);
  });

  it("serves only versioned APK names that exist: no listing, traversal or other files", async () => {
    writeFileSync(path.join(release.dir, "android", "secret.txt"), "nope");
    writeFileSync(path.join(release.dir, "secret.txt"), "nope");
    for (const url of ["/downloads/", "/downloads/android/", "/downloads/android/secret.txt", "/downloads/android/baraq-9.9.9.apk",
      "/downloads/android/evil.apk", "/downloads/android/..%2fsecret.txt", "/downloads/android/%2e%2e/secret.txt", "/downloads/secret.txt"]) {
      const response = await fetch(site.base + url, { redirect: "manual" });
      assert.equal(response.status, 404, url);
    }
    const post = await fetch(`${site.base}/downloads/android/${release.file}`, { method: "POST" });
    assert.equal(post.status, 405);
  });

  it("/links offers the download button", async () => {
    const html = await (await fetch(`${site.base}/links`)).text();
    assert.match(html, /link-btn--download/);
    assert.ok(html.includes("https://baraqapp.com/download/"));
  });
});

describe("Android downloads: nothing (valid) published", () => {
  const cases = {
    "no downloads folder": () => ({ dir: path.join(tmpdir(), "baraq-dl-missing-" + process.pid) }),
    "manifest names a file that is not on disk": () => { const r = makeRelease(); writeFileSync(path.join(r.dir, "android", "latest.json"), JSON.stringify({ ...r.latest, file: "baraq-2.0.0.apk", versionName: "2.0.0" })); return r; },
    "size on disk differs (half-copied upload)": () => { const r = makeRelease(); writeFileSync(path.join(r.dir, "android", "latest.json"), JSON.stringify({ ...r.latest, sizeBytes: r.bytes.length + 1 })); return r; },
    "malformed fingerprint": () => makeRelease({ manifest: { sha256: "zz" } }),
    "version does not match the file name": () => makeRelease({ manifest: { versionName: "9.9.9" } }),
    "someone else's application id": () => makeRelease({ manifest: { applicationId: "com.evil.app" } }),
    "file name outside the pattern": () => { const r = makeRelease(); writeFileSync(path.join(r.dir, "android", "latest.json"), JSON.stringify({ ...r.latest, file: "../latest.json" })); return r; },
    "manifest is not JSON": () => { const r = makeRelease(); writeFileSync(path.join(r.dir, "android", "latest.json"), "{oops"); return r; }
  };
  for (const [name, build] of Object.entries(cases)) {
    it(`shows "being prepared" and no download link: ${name}`, async () => {
      const release = build();
      const site = await startServer({ BARAQ_DOWNLOADS_DIR: release.dir });
      try {
        for (const locale of ["ar", "en"]) {
          const response = await fetch(`${site.base}/${locale}/download/`);
          assert.equal(response.status, 200);
          const html = await response.text();
          assert.match(html, /dl-card--soon/, locale);
          assert.ok(!html.includes("/downloads/android/baraq-"), `${locale}: no APK link`);
          assert.ok(!html.includes('class="btn btn-primary dl-btn"'), locale);
        }
        assert.equal((await fetch(`${site.base}/download/android`, { redirect: "manual" })).status, 404);
        assert.equal((await fetch(`${site.base}/downloads/android/latest.json`)).status, 404);
      } finally { site.stop(); }
    });
  }
});
