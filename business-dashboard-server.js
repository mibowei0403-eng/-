const http = require("http");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const dataFile = process.env.DASHBOARD_DATA_FILE
  ? path.resolve(process.env.DASHBOARD_DATA_FILE)
  : path.join(root, "business-dashboard-data.json");
const backupFile = `${dataFile}.bak`;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const emptyData = {
  devices: [],
  rentalOrders: [],
  income: [],
  expense: [],
  loans: [],
  customers: [],
  badDebts: []
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function isValidDashboardData(data) {
  return data
    && Array.isArray(data.devices)
    && Array.isArray(data.rentalOrders)
    && Array.isArray(data.income)
    && Array.isArray(data.expense)
    && Array.isArray(data.loans)
    && Array.isArray(data.customers)
    && Array.isArray(data.badDebts);
}

function readDashboardFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function writeBackupIfPossible() {
  if (fs.existsSync(dataFile)) {
    fs.copyFileSync(dataFile, backupFile);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/data") {
    if (req.method === "GET") {
      if (!fs.existsSync(dataFile)) {
        sendJson(res, 200, emptyData);
        return;
      }

      try {
        const data = readDashboardFile(dataFile);
        if (isValidDashboardData(data)) {
          sendJson(res, 200, data);
          return;
        }
        if (fs.existsSync(backupFile)) {
          const backup = readDashboardFile(backupFile);
          sendJson(res, 200, isValidDashboardData(backup) ? backup : emptyData);
          return;
        }
        sendJson(res, 200, emptyData);
      } catch {
        try {
          if (fs.existsSync(backupFile)) {
            const backup = readDashboardFile(backupFile);
            sendJson(res, 200, isValidDashboardData(backup) ? backup : emptyData);
            return;
          }
        } catch {
          // fall through
        }
        sendJson(res, 200, emptyData);
      }
      return;
    }

    if (req.method === "POST") {
      try {
        const data = JSON.parse(await readBody(req));
        if (!isValidDashboardData(data)) {
          sendJson(res, 400, { ok: false, error: "Invalid dashboard data" });
          return;
        }

        fs.mkdirSync(path.dirname(dataFile), { recursive: true });
        writeBackupIfPossible();
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), "utf8");
        sendJson(res, 200, { ok: true, dataFile });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error.message });
      }
      return;
    }

    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  const requested = url.pathname === "/" ? "business-dashboard.html" : decodeURIComponent(url.pathname.slice(1));
  const target = path.resolve(root, requested);
  if (!target.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(target, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "Content-Type": contentTypes[path.extname(target)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`经营驾驶舱已启动: http://127.0.0.1:${port}/business-dashboard.html`);
  console.log(`数据文件位置: ${dataFile}`);
});
