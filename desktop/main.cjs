/* eslint-disable @typescript-eslint/no-require-imports */
const { access, readFile, stat } = require("node:fs/promises");
const path = require("node:path");

const APP_NAME = "Midori Kanjo";
// Keep the legacy user-data directory so the rebrand never hides existing bills,
// product photos, settings, or offline drafts from installed desktop users.
const DATA_DIRECTORY_NAME = "Mantu Billing Software";
const APP_ORIGIN = "mantu://app";
const STATIC_ROOT = process.env.MANTU_STATIC_ROOT
  ? path.resolve(process.env.MANTU_STATIC_ROOT)
  : path.join(__dirname, "mobile-dist");

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function safeStaticPath(requestUrl) {
  const url = new URL(requestUrl);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  const candidate = path.resolve(STATIC_ROOT, `.${pathname}`);
  const relative = path.relative(STATIC_ROOT, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return candidate;
}

async function selfTest() {
  const required = ["index.html", "sw.js", "app-icon-512.png"];
  for (const file of required) await access(path.join(STATIC_ROOT, file));
  const index = await readFile(path.join(STATIC_ROOT, "index.html"), "utf8");
  const assets = await stat(STATIC_ROOT);
  if (!assets.isDirectory() || !index.includes(APP_NAME)) {
    throw new Error("The embedded Midori Kanjo application is incomplete.");
  }
  console.log(
    JSON.stringify({
      status: "ok",
      appName: APP_NAME,
      origin: APP_ORIGIN,
      requiredFiles: required.length,
    }),
  );
}

if (process.argv.includes("--self-test")) {
  selfTest().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
} else {
  const { app, BrowserWindow, protocol, session, shell } = require("electron");

  protocol.registerSchemesAsPrivileged([
    {
      scheme: "mantu",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        serviceWorkers: true,
      },
    },
  ]);

  app.setName(APP_NAME);
  app.setAppUserModelId("com.mantu.billing");
  app.setPath("userData", path.join(app.getPath("appData"), DATA_DIRECTORY_NAME));

  let mainWindow = null;

  function isExternalUrl(url) {
    return /^(https?:|mailto:|tel:)/i.test(url);
  }

  function configureWebContents(contents) {
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (
        url === "about:blank" ||
        url.startsWith("blob:") ||
        url.startsWith(APP_ORIGIN)
      ) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            backgroundColor: "#f9f9f9",
            title: APP_NAME,
            webPreferences: {
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              spellcheck: false,
            },
          },
        };
      }
      if (isExternalUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
    });

    contents.on("will-navigate", (event, url) => {
      if (
        url.startsWith(APP_ORIGIN) ||
        url.startsWith("blob:") ||
        url === "about:blank"
      )
        return;
      event.preventDefault();
      if (isExternalUrl(url)) void shell.openExternal(url);
    });
  }

  async function handleMantuRequest(request) {
    const requestedPath = safeStaticPath(request.url);
    if (!requestedPath) return new Response("Not found", { status: 404 });

    let filePath = requestedPath;
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = path.join(filePath, "index.html");
    } catch {
      if (!path.extname(filePath))
        filePath = path.join(STATIC_ROOT, "index.html");
    }

    try {
      const body = await readFile(filePath);
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type":
            MIME_TYPES.get(path.extname(filePath).toLowerCase()) ||
            "application/octet-stream",
          "Cache-Control":
            filePath.endsWith("index.html") || filePath.endsWith("sw.js")
              ? "no-cache"
              : "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "no-referrer",
          "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
          "Content-Security-Policy":
            "default-src 'self'; connect-src 'self' https: wss:; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'self' blob:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 860,
      minHeight: 620,
      show: false,
      backgroundColor: "#f9f9f9",
      title: APP_NAME,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    mainWindow.once("ready-to-show", () => mainWindow?.show());
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
    void mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  }

  const hasLock = app.requestSingleInstanceLock();
  if (!hasLock) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      if (!mainWindow) createWindow();
      if (mainWindow?.isMinimized()) mainWindow.restore();
      mainWindow?.show();
      mainWindow?.focus();
    });

    app.whenReady().then(() => {
      protocol.handle("mantu", handleMantuRequest);
      session.defaultSession.setPermissionCheckHandler(() => false);
      session.defaultSession.setPermissionRequestHandler(
        (_webContents, _permission, callback) => callback(false),
      );
      app.on("web-contents-created", (_event, contents) =>
        configureWebContents(contents),
      );
      createWindow();
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });
  }
}
