const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.FRONTEND_PORT || 8080);
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:3000";
const API_SECRET = process.env.API_SECRET || "initial-lab-secret-0000";
const ROOT = __dirname;

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
};

function serveStatic(req, res) {
    if (req.url === "/config.js") {
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
        res.end(`window.APP_CONFIG = { apiKey: "${API_SECRET}" };\n`);
        return;
    }

    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);

    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            filePath = path.join(ROOT, "index.html");
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
            "Content-Type": MIME[ext] || "text/plain; charset=utf-8",
        });
        fs.createReadStream(filePath).pipe(res);
    });
}

function getProxyOptions(req) {
    const url = new URL(BACKEND_URL);
    return {
        hostname: url.hostname,
        port: url.port || 3000,
        path: req.url,
        method: req.method,
        headers: req.headers,
    };
}

function proxyRequest(req, res) {
    const pReq = http.request(getProxyOptions(req), (pRes) => {
        res.writeHead(pRes.statusCode, pRes.headers);
        pRes.pipe(res);
    });
    pReq.on("error", () => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Backend not reachable. Is it running on :3000?" }));
    });
    req.pipe(pReq);
}

http
    .createServer((req, res) => {
        if (req.url.startsWith("/api/") || req.url === "/health") {
            proxyRequest(req, res);
        } else {
            serveStatic(req, res);
        }
    })
    .listen(PORT, () => {
        console.log(`Frontend dev server: http://localhost:${PORT}  (backend -> ${BACKEND_URL})`);
    });
