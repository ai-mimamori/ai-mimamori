import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { scanDirectory, specialPlaces } from "./lib/scan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const DEMO_DIR = path.join(__dirname, "samples", "ai-made-tool");
const PORT = Number(process.env.PORT) || 3780;
const BIND_HOST = "127.0.0.1";
const SESSION_TOKEN = crypto.randomBytes(24).toString("hex");
const LOCAL_ORIGIN = `http://${BIND_HOST}:${PORT}`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function hostName(req) {
  return String(req.headers.host || "").split(":")[0].toLowerCase();
}

function isLocalHost(req) {
  const host = hostName(req);
  return host === "127.0.0.1" || host === "localhost";
}

function isLocalOrigin(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return true;
  return origin === LOCAL_ORIGIN || origin === `http://localhost:${PORT}`;
}

function send(res, status, body, headers = {}) {
  const payload = Buffer.from(body);
  res.writeHead(status, {
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(payload);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), {
    "Content-Type": "application/json; charset=utf-8",
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    send(res, 403, "Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(res, 404, "Not found");
    return;
  }
  const ext = path.extname(filePath);
  send(res, 200, fs.readFileSync(filePath), {
    "Content-Type": MIME[ext] || "application/octet-stream",
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!isLocalHost(req) || !isLocalOrigin(req)) {
      sendJson(res, 403, { ok: false, error: "このアプリは、このPCの画面からだけ使えます。" });
      return;
    }
    const url = new URL(req.url, LOCAL_ORIGIN);
    if (req.method === "GET" && url.pathname === "/api/places") {
      sendJson(res, 200, {
        demoPath: DEMO_DIR,
        places: specialPlaces(),
        token: SESSION_TOKEN,
        bind: `${BIND_HOST}:${PORT}`,
        hostname: os.hostname(),
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/scan") {
      if (req.headers["x-mimamori-token"] !== SESSION_TOKEN) {
        sendJson(res, 403, { ok: false, error: "このPCで起動した画面から開き直してください。" });
        return;
      }
      const raw = await readBody(req);
      let payload = {};
      try {
        payload = JSON.parse(raw || "{}");
      } catch {
        sendJson(res, 400, { ok: false, error: "リクエストの形式が正しくありません。" });
        return;
      }
      const target = payload.demo ? DEMO_DIR : payload.path;
      const result = scanDirectory(target);
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    }
    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }
    send(res, 405, "Method not allowed");
  } catch (err) {
    sendJson(res, 500, { ok: false, error: "検査中に問題が起きました。フォルダの場所を変えて試してください。" });
    console.error(err);
  }
});

server.listen(PORT, BIND_HOST, () => {
  console.log(`AIみまもり ${LOCAL_ORIGIN}`);
  console.log("このPCの中だけです。社内LANにもインターネットにも出ていません。");
  console.log("止めるときは、この窓を閉じてください。");
});
