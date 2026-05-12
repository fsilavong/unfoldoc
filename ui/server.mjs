import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;
const distDir = path.join(rootDir, "dist");
const staticDir = path.join(rootDir, "static");
const dataDir = process.env.UNFOLDOC_DATA_DIR || path.join(rootDir, ".unfoldoc-data");
const statePath = path.join(dataDir, "source.json");
const cacheDir = path.join(dataDir, "cache");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const fixedSourceInput = process.env.UNFOLDOC_SOURCE_URL?.trim() || "";
const allowSourceChange = process.env.UNFOLDOC_ALLOW_SOURCE_CHANGE === "true";
let fixedSourceCache = undefined;

fs.mkdirSync(cacheDir, { recursive: true });

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf-8").trim();
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function slugify(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
}

function looksLikeGitHub(input) {
  return /^https?:\/\/github\.com\//.test(input) || /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input);
}

function parseGithubInput(input) {
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input)) {
    return {
      cloneUrl: `https://github.com/${input}.git`,
      label: input,
    };
  }

  const url = new URL(input);
  if (url.hostname !== "github.com") {
    throw new Error("Only github.com repository URLs are allowed");
  }

  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length < 2) {
    throw new Error("Invalid GitHub URL");
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");
  let branch;
  let subpath = "";

  if (parts[2] === "tree" && parts[3]) {
    branch = parts[3];
    subpath = parts.slice(4).join("/");
  }

  return {
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    label: `${owner}/${repo}`,
    branch,
    subpath: subpath || undefined,
  };
}

function ensureGitHubCheckout(input) {
  const parsed = parseGithubInput(input);
  const key = crypto.createHash("sha1").update(input).digest("hex").slice(0, 10);
  const repoDir = path.join(cacheDir, `${slugify(parsed.label)}-${key}`);

  if (!fs.existsSync(repoDir)) {
    const args = ["clone", "--depth", "1"];
    if (parsed.branch) {
      args.push("--branch", parsed.branch);
    }
    args.push(parsed.cloneUrl, repoDir);
    execFileSync("git", args, { stdio: "pipe" });
  } else if (parsed.branch) {
    execFileSync("git", ["-C", repoDir, "fetch", "--depth", "1", "origin", parsed.branch], { stdio: "pipe" });
    execFileSync("git", ["-C", repoDir, "checkout", "-B", parsed.branch, "FETCH_HEAD"], { stdio: "pipe" });
    execFileSync("git", ["-C", repoDir, "clean", "-fd"], { stdio: "pipe" });
  } else {
    execFileSync("git", ["-C", repoDir, "fetch", "--depth", "1", "origin"], { stdio: "pipe" });
    execFileSync("git", ["-C", repoDir, "reset", "--hard", "FETCH_HEAD"], { stdio: "pipe" });
    execFileSync("git", ["-C", repoDir, "clean", "-fd"], { stdio: "pipe" });
  }

  const rootPath = parsed.subpath ? path.join(repoDir, parsed.subpath) : repoDir;
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    throw new Error(`GitHub path does not exist: ${rootPath}`);
  }

  return {
    input,
    type: "github",
    label: parsed.label,
    rootPath,
    branch: parsed.branch,
    subpath: parsed.subpath,
  };
}

function detectSource(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) {
    throw new Error("Source is required");
  }
  if (!looksLikeGitHub(trimmed)) {
    throw new Error("Only GitHub repositories are supported");
  }
  return ensureGitHubCheckout(trimmed);
}

function readFixedSource() {
  if (!fixedSourceInput) {
    return null;
  }
  if (fixedSourceCache === undefined) {
    fixedSourceCache = detectSource(fixedSourceInput);
  }
  return fixedSourceCache;
}

function readState() {
  if (fixedSourceInput) {
    return readFixedSource();
  }
  if (!fs.existsSync(statePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(statePath, "utf-8"));
}

function writeState(value) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(value, null, 2), "utf-8");
}

function refreshSource(source) {
  if (!source) return null;
  if (fixedSourceInput && source.input === fixedSourceInput) {
    fixedSourceCache = ensureGitHubCheckout(source.input);
    return fixedSourceCache;
  }
  return ensureGitHubCheckout(source.input);
}

function deriveDocumentRecord(rootPath, contentPath) {
  const relative = path.relative(rootPath, contentPath).replace(/\\/g, "/");
  const parts = relative.split("/");
  const parentParts = parts.slice(0, -1);
  const hasLeadingDate = /^\d{4}-\d{2}-\d{2}$/.test(parentParts[0] || "");
  const date = hasLeadingDate ? parentParts[0] : "";
  const title = parentParts[parentParts.length - 1] || "document";

  return {
    id: parentParts.join("/") || relative,
    date,
    title,
    folder_parts: parentParts,
    artifact_path: relative,
  };
}

function listDocuments(rootPath) {
  const documents = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === "content.md") {
        documents.push(deriveDocumentRecord(rootPath, fullPath));
      }
    }
  }

  walk(rootPath);
  return documents.sort((a, b) => b.id.localeCompare(a.id));
}

function ensureInside(rootPath, relativePath) {
  const targetPath = path.resolve(rootPath, relativePath);
  const rel = path.relative(rootPath, targetPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path escapes source root");
  }
  return targetPath;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if ([".md", ".txt", ".py", ".json", ".yaml", ".yml", ".csv", ".log"].includes(ext)) return "text/plain; charset=utf-8";
  if (ext === ".html" || ext === ".htm") return "text/html; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".flac") return "audio/flac";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function sendJson(res, statusCode, value) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value, null, 2));
}

function sendText(res, statusCode, text) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(text);
}

function serveFile(res, filePath, raw = false, req = null) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not found");
    return;
  }

  const contentType = raw ? contentTypeFor(filePath) : "text/plain; charset=utf-8";
  res.setHeader("Content-Type", contentType);

  if (!raw) {
    res.end(fs.readFileSync(filePath, "utf-8"));
    return;
  }

  const total = fs.statSync(filePath).size;
  const rangeHeader = req?.headers.range;
  res.setHeader("Accept-Ranges", "bytes");

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? parseInt(match[1], 10) : 0;
    const end = match?.[2] ? parseInt(match[2], 10) : total - 1;
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Content-Length", end - start + 1);
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.setHeader("Content-Length", total);
  fs.createReadStream(filePath).pipe(res);
}

function resolveStaticAsset(pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const candidates = [
    path.join(distDir, cleanPath),
    path.join(staticDir, cleanPath),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/api/source") {
      if (req.method === "GET") {
        const source = refreshSource(readState());
        if (source && !fixedSourceInput) {
          writeState(source);
        }
        sendJson(res, 200, { source, read_only: Boolean(fixedSourceInput) || !allowSourceChange });
        return;
      }

      if (fixedSourceInput || !allowSourceChange) {
        sendJson(res, 403, { error: "Source changes are disabled in production" });
        return;
      }

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        const source = detectSource(body.input);
        writeState(source);
        sendJson(res, 200, { source, read_only: false });
        return;
      }

      if (req.method === "DELETE") {
        if (fs.existsSync(statePath)) {
          fs.unlinkSync(statePath);
        }
        res.statusCode = 204;
        res.end();
        return;
      }

      sendText(res, 405, "Method not allowed");
      return;
    }

    if (requestUrl.pathname === "/api/documents") {
      const source = readState();
      if (!source) {
        sendJson(res, 200, { source: null, documents: [] });
        return;
      }

      const documents = listDocuments(source.rootPath);
      sendJson(res, 200, { source, documents });
      return;
    }

    if (requestUrl.pathname === "/api/file" || requestUrl.pathname === "/api/raw") {
      const source = readState();
      if (!source) {
        sendText(res, 404, "No source configured");
        return;
      }

      const relativePath = requestUrl.searchParams.get("path");
      if (!relativePath) {
        sendText(res, 400, "Missing path");
        return;
      }

      const targetPath = ensureInside(source.rootPath, relativePath);
      serveFile(res, targetPath, requestUrl.pathname === "/api/raw", req);
      return;
    }

    const staticFile = resolveStaticAsset(requestUrl.pathname);
    if (staticFile) {
      serveFile(res, staticFile, true, req);
      return;
    }

    serveFile(res, path.join(distDir, "index.html"), true, req);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, host, () => {
  console.log(`Unfoldoc server listening on http://${host}:${port}`);
});
