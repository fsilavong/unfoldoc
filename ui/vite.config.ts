import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

type SourceConfig = {
  input: string;
  type: "github";
  label: string;
  rootPath: string;
  branch?: string;
  subpath?: string;
};

function readJsonBody(req: NodeJS.ReadableStream): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
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

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
}

function looksLikeGitHub(input: string): boolean {
  return (
    /^https?:\/\/github\.com\//.test(input) ||
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input)
  );
}

function parseGithubInput(input: string): { cloneUrl: string; label: string; branch?: string; subpath?: string } {
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
  let branch: string | undefined;
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

function ensureGitHubCheckout(cacheDir: string, input: string): SourceConfig {
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
  } else {
    if (parsed.branch) {
      execFileSync("git", ["-C", repoDir, "fetch", "--depth", "1", "origin", parsed.branch], { stdio: "pipe" });
      execFileSync("git", ["-C", repoDir, "checkout", "-B", parsed.branch, "FETCH_HEAD"], { stdio: "pipe" });
    } else {
      execFileSync("git", ["-C", repoDir, "fetch", "--depth", "1", "origin"], { stdio: "pipe" });
      execFileSync("git", ["-C", repoDir, "reset", "--hard", "FETCH_HEAD"], { stdio: "pipe" });
      execFileSync("git", ["-C", repoDir, "clean", "-fd"], { stdio: "pipe" });
    }
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

function detectSource(cacheDir: string, input: string): SourceConfig {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Source is required");
  }
  if (!looksLikeGitHub(trimmed)) {
    throw new Error("Only GitHub repositories are supported");
  }
  return ensureGitHubCheckout(cacheDir, trimmed);
}

function readState(statePath: string): SourceConfig | null {
  if (!fs.existsSync(statePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(statePath, "utf-8")) as SourceConfig;
}

function refreshSource(cacheDir: string, source: SourceConfig | null): SourceConfig | null {
  if (!source) {
    return null;
  }
  if (source.type === "github") {
    return ensureGitHubCheckout(cacheDir, source.input);
  }
  return source;
}

function writeState(statePath: string, value: SourceConfig): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(value, null, 2), "utf-8");
}

function deriveDocumentRecord(rootPath: string, contentPath: string) {
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

function listDocuments(rootPath: string) {
  const documents: Array<Record<string, string>> = [];

  function walk(currentDir: string) {
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

function ensureInside(rootPath: string, relativePath: string): string {
  const targetPath = path.resolve(rootPath, relativePath);
  const rel = path.relative(rootPath, targetPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path escapes source root");
  }
  return targetPath;
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if ([".md", ".txt", ".py", ".json", ".yaml", ".yml", ".csv", ".log"].includes(ext)) {
    return "text/plain; charset=utf-8";
  }
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
  return "application/octet-stream";
}

export default defineConfig({
  publicDir: "static",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon-16.png", "favicon-32.png", "apple-touch-icon.png"],
      manifest: {
        name: "Unfoldoc",
        short_name: "Unfoldoc",
        description: "Reader UI for Unfoldoc markdown-native document bundles.",
        theme_color: "#0d1117",
        background_color: "#0d1117",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/web-app-manifest-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/web-app-manifest-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,md,json}"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
    {
      name: "unfoldoc-source-server",
      configureServer(server) {
        const repoRoot = path.resolve(__dirname, "..", "..");
        const statePath = path.join(repoRoot, ".unfoldoc-source.json");
        const cacheDir = path.join(repoRoot, ".unfoldoc-cache");
        const fixedSourceInput = process.env.UNFOLDOC_SOURCE_URL?.trim() || "";
        const allowSourceChange = process.env.UNFOLDOC_ALLOW_SOURCE_CHANGE === "true";
        let fixedSourceCache: SourceConfig | null | undefined;

        function readFixedSource(): SourceConfig | null {
          if (!fixedSourceInput) {
            return null;
          }
          if (fixedSourceCache === undefined) {
            fixedSourceCache = detectSource(cacheDir, fixedSourceInput);
          }
          return fixedSourceCache;
        }

        function readEffectiveState(): SourceConfig | null {
          if (fixedSourceInput) {
            return readFixedSource();
          }
          return readState(statePath);
        }

        server.middlewares.use("/api/source", async (req, res) => {
          try {
            if (req.method === "GET") {
              const source = refreshSource(cacheDir, readEffectiveState());
              if (fixedSourceInput && source) {
                fixedSourceCache = source;
              }
              if (source && !fixedSourceInput) {
                writeState(statePath, source);
              }
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ source, read_only: Boolean(fixedSourceInput) || !allowSourceChange }, null, 2));
              return;
            }

            if (fixedSourceInput || !allowSourceChange) {
              res.statusCode = 403;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: "Source changes are disabled in production" }));
              return;
            }

            if (req.method === "POST") {
              const body = await readJsonBody(req);
              const source = detectSource(cacheDir, String(body.input ?? ""));
              writeState(statePath, source);
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ source, read_only: false }, null, 2));
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

            res.statusCode = 405;
            res.end("Method not allowed");
          } catch (error) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
        });

        server.middlewares.use("/api/documents", (req, res) => {
          try {
            const source = readEffectiveState();
            if (!source) {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ source: null, documents: [] }, null, 2));
              return;
            }

            const documents = listDocuments(source.rootPath);
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ source, documents }, null, 2));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
        });

        server.middlewares.use("/api/file", (req, res) => {
          try {
            const source = readEffectiveState();
            if (!source) {
              res.statusCode = 404;
              res.end("No source configured");
              return;
            }

            const requestUrl = new URL(req.url ?? "", "http://localhost");
            const relativePath = requestUrl.searchParams.get("path");
            if (!relativePath) {
              res.statusCode = 400;
              res.end("Missing path");
              return;
            }

            const targetPath = ensureInside(source.rootPath, relativePath);
            if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
              res.statusCode = 404;
              res.end("Not found");
              return;
            }

            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end(fs.readFileSync(targetPath, "utf-8"));
          } catch (error) {
            res.statusCode = 500;
            res.end(error instanceof Error ? error.message : String(error));
          }
        });

        server.middlewares.use("/api/raw", (req, res) => {
          try {
            const source = readEffectiveState();
            if (!source) {
              res.statusCode = 404;
              res.end("No source configured");
              return;
            }

            const requestUrl = new URL(req.url ?? "", "http://localhost");
            const relativePath = requestUrl.searchParams.get("path");
            if (!relativePath) {
              res.statusCode = 400;
              res.end("Missing path");
              return;
            }

            const targetPath = ensureInside(source.rootPath, relativePath);
            if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
              res.statusCode = 404;
              res.end("Not found");
              return;
            }

            const contentType = contentTypeFor(targetPath);
            const total = fs.statSync(targetPath).size;
            const rangeHeader = (req as any).headers["range"] as string | undefined;

            res.setHeader("Content-Type", contentType);
            res.setHeader("Accept-Ranges", "bytes");

            if (rangeHeader) {
              const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
              const start = match?.[1] ? parseInt(match[1], 10) : 0;
              const end = match?.[2] ? parseInt(match[2], 10) : total - 1;
              res.statusCode = 206;
              res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
              res.setHeader("Content-Length", end - start + 1);
              fs.createReadStream(targetPath, { start, end }).pipe(res);
            } else {
              res.setHeader("Content-Length", total);
              fs.createReadStream(targetPath).pipe(res);
            }
          } catch (error) {
            res.statusCode = 500;
            res.end(error instanceof Error ? error.message : String(error));
          }
        });
      },
    },
  ],
});
