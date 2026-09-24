// Preloaded with `node --import` so server.js talks to a fake Apps Script.
// Every upstream call is appended to MOCK_SHEET_LOG as one JSON line.
import { appendFileSync } from "node:fs";

const mode = process.env.MOCK_SHEET_MODE || "ok";
const log = process.env.MOCK_SHEET_LOG;
let count = 19;
let countCalls = 0;

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const body = typeof init.body === "string" ? init.body : "";
  if (log) {
    appendFileSync(log, JSON.stringify({
      host: url.host,
      action: url.searchParams.get("action"),
      method: init.method || "GET",
      redirect: init.redirect,
      contentType: (init.headers || {})["Content-Type"] || "",
      body
    }) + "\n");
  }
  if (mode === "down") throw new TypeError("fetch failed");
  if (mode === "html") return new Response("<html>login</html>", { status: 200 });
  if (mode === "flaky-count" && url.searchParams.get("action") === "count" && countCalls++ === 0) {
    return new Response("<!DOCTYPE html><html>Not Found</html>", { status: 404 });
  }
  if (url.searchParams.get("action") === "join") {
    count += 1;
    return Response.json({ ok: true, created: true, count });
  }
  return Response.json({ ok: true, count });
};
