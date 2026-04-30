import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type SourceConfig = {
  input: string;
  type: "local" | "github";
  label: string;
  rootPath: string;
  branch?: string;
  subpath?: string;
};

type DocumentRecord = {
  id: string;
  date: string;
  title: string;
  folder_parts: string[];
  artifact_path: string;
};

type DrawerState =
  | { kind: "closed" }
  | { kind: "markdown"; title: string; markdown: string; sourcePath: string }
  | { kind: "json"; title: string; value: unknown; sourcePath: string }
  | { kind: "code"; title: string; language: string; text: string; sourcePath: string }
  | { kind: "html"; title: string; url: string; sourcePath: string }
  | { kind: "image"; title: string; url: string; sourcePath: string }
  | { kind: "link"; title: string; url: string; text?: string; sourcePath: string };

type AudioBlockSpec = {
  src: string;
  title: string;
  caption?: string;
};

type TreeNode = {
  id: string;
  name: string;
  depth: number;
  folderPath: string[];
  document: DocumentRecord | null;
  children: TreeNode[];
  docCount: number;
};

function extensionFromPath(path: string): string {
  const clean = path.split("#")[0].split("?")[0];
  const dot = clean.lastIndexOf(".");
  return dot === -1 ? "" : clean.slice(dot + 1).toLowerCase();
}

function languageFromExtension(ext: string): string {
  if (ext === "py") return "python";
  if (ext === "js" || ext === "mjs") return "javascript";
  if (ext === "ts") return "typescript";
  if (ext === "json") return "json";
  if (ext === "md") return "markdown";
  if (ext === "html") return "html";
  return ext || "text";
}

function isImageExtension(ext: string): boolean {
  return ["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext);
}

function isAudioExtension(ext: string): boolean {
  return ["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext);
}

function isTextExtension(ext: string): boolean {
  return ["py", "js", "mjs", "ts", "tsx", "jsx", "md", "txt", "json", "yaml", "yml", "csv", "log"].includes(ext);
}

function isHtmlExtension(ext: string): boolean {
  return ext === "html" || ext === "htm";
}

function normalizePath(path: string): string {
  const stack: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack.join("/");
}

function basename(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

function resolveRelativePath(baseFilePath: string, href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("#")) {
    return href;
  }
  const baseDir = baseFilePath.split("/").slice(0, -1).join("/");
  return normalizePath(`${baseDir}/${href}`);
}

function apiFile(path: string): string {
  return `/api/file?path=${encodeURIComponent(path)}`;
}

function apiRaw(path: string): string {
  return `/api/raw?path=${encodeURIComponent(path)}`;
}

function rawUrlForPath(basePath: string, href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return href;
  }
  return apiRaw(resolveRelativePath(basePath, href));
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function absolutizeMarkdownLinks(markdown: string, artifactPath: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
      if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("#")) {
        return `[${label}](${href})`;
      }
      return `[${label}](${resolveRelativePath(artifactPath, href)})`;
    })
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, label, href) => {
      if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("#")) {
        return `![${label}](${href})`;
      }
      return `![${label}](${resolveRelativePath(artifactPath, href)})`;
    });
}

type OrbitBlock = {
  run?: string;
  artifact?: string;
};

function parseAudioBlock(rawBlock: string): AudioBlockSpec | null {
  const spec: Partial<AudioBlockSpec> = {};

  for (const line of rawBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) {
      if (!spec.src) {
        spec.src = trimmed;
      }
      continue;
    }
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    if (key === "src" || key === "path") {
      spec.src = value;
    } else if (key === "title") {
      spec.title = value;
    } else if (key === "caption") {
      spec.caption = value;
    }
  }

  if (!spec.src) return null;
  return {
    src: spec.src,
    title: spec.title || "Audio",
    caption: spec.caption,
  };
}

function extractAudioBlock(children: React.ReactNode): AudioBlockSpec | null {
  const childArray = React.Children.toArray(children);
  if (childArray.length !== 1) {
    return null;
  }

  const child = childArray[0];
  if (!React.isValidElement<{ className?: string; children?: React.ReactNode }>(child)) {
    return null;
  }

  const className = child.props.className ?? "";
  const languageMatch = /language-([a-z0-9_-]+)/i.exec(className);
  if (!languageMatch || languageMatch[1].toLowerCase() !== "audio") {
    return null;
  }

  const text = React.Children.toArray(child.props.children).join("");
  return parseAudioBlock(String(text));
}

function parseOrbitBlock(rawBlock: string): OrbitBlock {
  const block: OrbitBlock = {};
  for (const line of rawBlock.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("run:")) {
      block.run = trimmed.slice(4).trim();
    } else if (trimmed.startsWith("artifact:")) {
      block.artifact = trimmed.slice(9).trim();
    }
  }
  return block;
}

async function expandOrbitBlocks(sourceMarkdown: string, sourcePath: string): Promise<string> {
  const blockRegex = /```orbit\s*([\s\S]*?)```/g;
  const matches = [...sourceMarkdown.matchAll(blockRegex)];
  if (matches.length === 0) {
    return sourceMarkdown;
  }

  let rendered = sourceMarkdown;
  for (const match of matches) {
    const block = parseOrbitBlock(match[1]);
    if (!block.artifact) continue;

    const artifactPath = resolveRelativePath(sourcePath, block.artifact);
    const response = await fetch(apiFile(artifactPath));
    if (!response.ok) {
      throw new Error(`Failed to load orbit artifact: ${response.status}`);
    }

    const ext = extensionFromPath(artifactPath);
    if (ext !== "md") {
      const replacement = [`> Orbit artifact: \`${artifactPath}\``, block.run ? `> Run: \`${block.run}\`` : "", ""]
        .filter(Boolean)
        .join("\n");
      rendered = rendered.replace(match[0], replacement);
      continue;
    }

    const artifactMarkdown = await response.text();
    rendered = rendered.replace(match[0], absolutizeMarkdownLinks(artifactMarkdown, artifactPath));
  }

  return rendered;
}

function compareTreeNames(a: string, b: string): number {
  const isDateA = /^\d{4}-\d{2}-\d{2}$/.test(a);
  const isDateB = /^\d{4}-\d{2}-\d{2}$/.test(b);
  if (isDateA && isDateB) {
    return b.localeCompare(a);
  }
  return a.localeCompare(b);
}

function buildDocumentTree(documents: DocumentRecord[]): TreeNode[] {
  type MutableTreeNode = Omit<TreeNode, "children" | "docCount"> & {
    childrenMap: Map<string, MutableTreeNode>;
  };

  const roots = new Map<string, MutableTreeNode>();

  for (const document of documents) {
    let currentLevel = roots;
    const traversed: string[] = [];

    for (const part of document.folder_parts) {
      traversed.push(part);
      let node = currentLevel.get(part);
      if (!node) {
        node = {
          id: traversed.join("/"),
          name: part,
          depth: traversed.length - 1,
          folderPath: [...traversed],
          document: null,
          childrenMap: new Map(),
        };
        currentLevel.set(part, node);
      }

      if (part === document.folder_parts[document.folder_parts.length - 1]) {
        node.document = document;
      }

      currentLevel = node.childrenMap;
    }
  }

  function finalize(nodes: MutableTreeNode[]): TreeNode[] {
    return [...nodes]
      .map((node) => {
        const children = finalize([...node.childrenMap.values()]);
        const docCount = (node.document ? 1 : 0) + children.reduce((sum, child) => sum + child.docCount, 0);
        return {
          id: node.id,
          name: node.name,
          depth: node.depth,
          folderPath: node.folderPath,
          document: node.document,
          children,
          docCount,
        };
      })
      .sort((a, b) => compareTreeNames(a.name, b.name));
  }

  return finalize([...roots.values()]);
}

function defaultDocumentId(documents: DocumentRecord[]): string {
  return [...documents]
    .sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) {
        return b.date.localeCompare(a.date);
      }
      if (a.date && !b.date) return -1;
      if (!a.date && b.date) return 1;
      return a.folder_parts.length - b.folder_parts.length || a.id.localeCompare(b.id);
    })[0]?.id ?? "";
}

const SPEEDS = [1, 1.5, 2] as const;
type Speed = (typeof SPEEDS)[number];

function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [speed, setSpeed] = useState<Speed>(1);

  function handleSpeed(rate: Speed) {
    setSpeed(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }

  return (
    <figure className="audio-embed">
      <div className="audio-embed-player-wrap">
        <audio ref={audioRef} controls preload="none" src={src}>
          <a href={src} target="_blank" rel="noreferrer">Open audio</a>
        </audio>
      </div>
      <div className="audio-speed-controls">
        {SPEEDS.map((rate) => (
          <button
            key={rate}
            className={`audio-speed-btn${speed === rate ? " active" : ""}`}
            onClick={() => handleSpeed(rate)}
          >
            {rate === 1 ? "1×" : `${rate}×`}
          </button>
        ))}
      </div>
    </figure>
  );
}

export default function App() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>("");
  const [markdown, setMarkdown] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [sourceConfig, setSourceConfig] = useState<SourceConfig | null>(null);
  const [sourceInput, setSourceInput] = useState<string>("");
  const [submittingSource, setSubmittingSource] = useState<boolean>(false);
  const [drawer, setDrawer] = useState<DrawerState>({ kind: "closed" });
  const [light, setLight] = useState<boolean>(() => localStorage.getItem("theme") === "light");
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({});
  const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false);

  useEffect(() => {
    document.documentElement.classList.toggle("light", light);
    localStorage.setItem("theme", light ? "light" : "dark");
  }, [light]);

  async function loadDocuments() {
    const response = await fetch("/api/documents");
    if (!response.ok) {
      throw new Error(`Failed to load documents: ${response.status}`);
    }
    const data = await response.json();
    setSourceConfig(data.source ?? null);
    setDocuments(data.documents ?? []);
    setSelectedDocumentId((current) => {
      if (current && (data.documents ?? []).some((doc: DocumentRecord) => doc.id === current)) {
        return current;
      }
      return defaultDocumentId(data.documents ?? []);
    });
  }

  useEffect(() => {
    fetch("/api/source")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load source: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        setSourceConfig(data.source ?? null);
        if (data.source) {
          return loadDocuments();
        }
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const selectedDoc = documents.find((item) => item.id === selectedDocumentId) ?? null;
  const treeNodes = useMemo(() => buildDocumentTree(documents), [documents]);
  useEffect(() => {
    function visit(nodes: TreeNode[], next: Record<string, boolean>) {
      for (const node of nodes) {
        if (!(node.id in next) && node.children.length > 0) {
          next[node.id] = node.depth >= 1;
        }
        visit(node.children, next);
      }
    }

    setCollapsedNodes((current) => {
      const next = { ...current };
      visit(treeNodes, next);
      return next;
    });
  }, [treeNodes]);

  useEffect(() => {
    if (!selectedDoc) return;

    fetch(apiFile(selectedDoc.artifact_path))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load artifact: ${response.status}`);
        }
        return response.text();
      })
      .then((text) => expandOrbitBlocks(text, selectedDoc.artifact_path))
      .then((text) => {
        setMarkdown(text);
        setDrawer({ kind: "closed" });
      })
      .catch((err: Error) => setError(err.message));
  }, [selectedDoc]);

  const localCitationCount = useMemo(() => {
    const matches = markdown.match(/\]\((?:\.\/)?[^)]*citations\/[^)]+\.(?:md|json)\)/g);
    return matches ? matches.length : 0;
  }, [markdown]);

  async function submitSource() {
    setSubmittingSource(true);
    setError("");
    try {
      const response = await fetch("/api/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: sourceInput }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Failed to save source: ${response.status}`);
      }
      setSourceConfig(data.source);
      setDocuments([]);
      setSelectedDocumentId("");
      setMobileNavOpen(false);
      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingSource(false);
    }
  }

  async function resetSource() {
    setError("");
    await fetch("/api/source", { method: "DELETE" });
    setSourceConfig(null);
    setDocuments([]);
    setSelectedDocumentId("");
    setMarkdown("");
    setDrawer({ kind: "closed" });
    setMobileNavOpen(false);
  }

  async function openLinkedResource(href: string, label: string, basePath: string) {
    if (!selectedDoc) return;

    if (/^https?:\/\//.test(href)) {
      if (drawer.kind !== "closed" && drawer.sourcePath === href) {
        setDrawer({ kind: "closed" });
        return;
      }
      setDrawer({
        kind: "link",
        title: label || href,
        url: href,
        sourcePath: href,
        text: "Remote URLs stay as links in the drawer. Unfoldoc can enrich these later with fetched metadata or cached source content.",
      });
      return;
    }

    const resolvedPath = resolveRelativePath(basePath, href);
    if (drawer.kind !== "closed" && drawer.sourcePath === resolvedPath) {
      setDrawer({ kind: "closed" });
      return;
    }
    const ext = extensionFromPath(resolvedPath);

    if (isImageExtension(ext)) {
      setDrawer({ kind: "image", title: label || href, url: apiRaw(resolvedPath), sourcePath: resolvedPath });
      return;
    }

    if (isAudioExtension(ext)) {
      setDrawer({ kind: "link", title: label || href, url: apiRaw(resolvedPath), sourcePath: resolvedPath });
      return;
    }

    if (isHtmlExtension(ext)) {
      setDrawer({ kind: "html", title: label || href, url: apiRaw(resolvedPath), sourcePath: resolvedPath });
      return;
    }

    if (isTextExtension(ext)) {
      const response = await fetch(apiFile(resolvedPath));
      const text = await response.text();
      if (ext === "md") {
        setDrawer({ kind: "markdown", title: label || href, markdown: text, sourcePath: resolvedPath });
        return;
      }
      if (ext === "json") {
        setDrawer({ kind: "json", title: label || href, value: tryParseJson(text), sourcePath: resolvedPath });
        return;
      }
      setDrawer({
        kind: "code",
        title: label || href,
        language: languageFromExtension(ext),
        text,
        sourcePath: resolvedPath,
      });
      return;
    }

    setDrawer({ kind: "link", title: label || href, url: apiRaw(resolvedPath), sourcePath: resolvedPath });
  }

  function renderTreeNode(node: TreeNode) {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsedNodes[node.id] ?? false;
    const active = node.document?.id === selectedDoc?.id;
    const rowClass = `${node.depth === 0 ? "tree-group-label" : "tree-subgroup-label"}${active ? " tree-node-active" : ""}`;

    const handleRowClick = () => {
      if (node.document) {
        setSelectedDocumentId(node.document.id);
        setMobileNavOpen(false);
        return;
      }
      if (hasChildren) {
        setCollapsedNodes((current) => ({ ...current, [node.id]: !isCollapsed }));
      }
    };

    return (
      <div key={node.id} className={node.depth === 0 ? "tree-group" : "tree-subgroup"}>
        <button type="button" className={rowClass} onClick={handleRowClick}>
          {hasChildren ? (
            <span
              className="tree-caret"
              onClick={(event) => {
                event.stopPropagation();
                setCollapsedNodes((current) => ({ ...current, [node.id]: !isCollapsed }));
              }}
            >
              {isCollapsed ? "▸" : "▾"}
            </span>
          ) : (
            <span className="tree-caret" />
          )}
          <span className="tree-label-main">{node.name}</span>
          {hasChildren ? <span className="tree-node-count">{node.docCount}</span> : null}
        </button>
        {hasChildren && !isCollapsed ? node.children.map((child) => renderTreeNode(child)) : null}
      </div>
    );
  }

  function renderMarkdown(markdownText: string, sourcePath: string) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(value) => value}
        components={{
          a: ({ href, children }) => {
            const label = Array.isArray(children) ? children.join("") : String(children);
            const isLocalCitation =
              typeof href === "string" &&
              href.includes("citations/") &&
              ["md", "json"].includes(extensionFromPath(href));
            const isBarExternalUrl =
              typeof href === "string" &&
              (href.startsWith("http://") || href.startsWith("https://")) &&
              label === href;
            if (isBarExternalUrl) {
              return (
                <a
                  className="md-external-link"
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {new URL(href).hostname.replace(/^www\./, "")}
                </a>
              );
            }
            if (isLocalCitation) {
              return (
                <sup>
                  <button
                    type="button"
                    className="citation"
                    onClick={() => href && void openLinkedResource(href, label, sourcePath)}
                  >
                    {label.replace(/[^\d]/g, "") || label}
                  </button>
                </sup>
              );
            }
            return (
              <button
                type="button"
                className="md-link-button"
                onClick={() => href && void openLinkedResource(href, label, sourcePath)}
                title={label}
              >
                {children}
              </button>
            );
          },
          pre: ({ children }) => {
            const audio = extractAudioBlock(children);
            if (!audio) {
              return <pre>{children}</pre>;
            }
            return <AudioPlayer src={rawUrlForPath(sourcePath, audio.src)} />;
          },
        }}
      >
        {markdownText}
      </ReactMarkdown>
    );
  }

  if (!sourceConfig) {
    return (
      <main className="setup-shell">
        <section className="setup-card">
          <div className="setup-brand">
            <img className="brand-mark brand-mark-setup" src="/logo-128.png" alt="" aria-hidden="true" />
            <h1>Unfoldoc</h1>
          </div>
          <p className="setup-copy">
            Enter a local folder or a GitHub repo URL. Unfoldoc will detect the source type, remember it, and only ask again if you reset it.
          </p>
          <input
            className="setup-input"
            value={sourceInput}
            onChange={(event) => setSourceInput(event.target.value)}
            placeholder="/Users/fran/projects/orbit/data/daily-digest or https://github.com/fsilavong/unfoldoc"
          />
          <button type="button" className="setup-btn" onClick={() => void submitSource()} disabled={submittingSource}>
            {submittingSource ? "Loading…" : "Load source"}
          </button>
          {error ? <p className="setup-error">{error}</p> : null}
        </section>
      </main>
    );
  }

  if (error) {
    return <main className="loading-state">Failed to load: {error}</main>;
  }

  if (documents.length === 0) {
    return (
      <main className="loading-state">
        No bundles found in <code>{sourceConfig.rootPath}</code>.
      </main>
    );
  }

  if (!selectedDoc) {
    return <main className="loading-state">Loading Unfoldoc…</main>;
  }

  return (
    <div className="app">
      <div
        className={mobileNavOpen ? "mobile-nav-overlay open" : "mobile-nav-overlay"}
        onClick={() => setMobileNavOpen(false)}
      />
      <aside className={mobileNavOpen ? "left mobile-open" : "left"}>
        <div className="left-hdr">
          <div className="left-brand">
            <img className="brand-mark brand-mark-sidebar" src="/logo-128.png" alt="" aria-hidden="true" />
            <div className="left-brand-copy">
              <h2>Unfoldoc</h2>
              <p>Document tree</p>
            </div>
          </div>
          <button type="button" className="theme-btn" onClick={() => setLight((value) => !value)}>
            {light ? "Dark" : "Light"}
          </button>
        </div>

        <div className="search-wrap">
          <div className="source-card">
            <div className="source-card-top">
              <span className="source-card-kicker">{sourceConfig.type}</span>
              <span className="source-card-count">{documents.length} docs</span>
            </div>
            <div className="source-card-title">{sourceConfig.label}</div>
          </div>
          <button type="button" className="reset-btn" onClick={() => void resetSource()}>
            Reset source
          </button>
        </div>

        <div className="tree-scroll">
          {treeNodes.map((node) => renderTreeNode(node))}
        </div>
      </aside>

      <section className="right">
        <div className="mobile-topbar">
          <button type="button" className="mobile-menu-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
            <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
              <rect width="16" height="1.5" rx="0.75" fill="currentColor"/>
              <rect y="5.25" width="16" height="1.5" rx="0.75" fill="currentColor"/>
              <rect y="10.5" width="16" height="1.5" rx="0.75" fill="currentColor"/>
            </svg>
          </button>
          <div className="mobile-topbar-title">
            <span className="mobile-wordmark" aria-label="Unfoldoc">unfoldoc</span>
          </div>
        </div>
        <div className="viewer-shell">
          <section className="viewer-pane">
            <article className="content markdown-content md-body">
              <div className="prose-wrap">
                {renderMarkdown(markdown, selectedDoc.artifact_path)}
              </div>
            </article>
          </section>
        </div>
      </section>

      <div
        className={drawer.kind !== "closed" ? "drawer-overlay open" : "drawer-overlay"}
        onClick={() => setDrawer({ kind: "closed" })}
      />
      <aside className={drawer.kind !== "closed" ? "drawer open" : "drawer"} aria-hidden={drawer.kind === "closed"}>
        {drawer.kind !== "closed" ? (
          <>
            <div className="drawer-hdr">
              <div className="drawer-hdr-left">
                <div className="drawer-section-title">Linked resource</div>
                <h3>{drawer.title}</h3>
              </div>
              <button className="drawer-close" onClick={() => setDrawer({ kind: "closed" })}>
                ✕ Close
              </button>
            </div>

            <div className="drawer-body">
              {drawer.kind === "markdown" ? (
                <div className="drawer-markdown">
                  {renderMarkdown(drawer.markdown, drawer.sourcePath)}
                </div>
              ) : null}

              {drawer.kind === "json" ? (
                <div className="drawer-json">
                  <p className="info-label">json</p>
                  <pre>{JSON.stringify(drawer.value, null, 2)}</pre>
                </div>
              ) : null}

              {drawer.kind === "code" ? (
                <div className="drawer-code">
                  <p className="info-label">{drawer.language}</p>
                  <pre>{drawer.text}</pre>
                </div>
              ) : null}

              {drawer.kind === "html" ? <iframe className="drawer-frame" src={drawer.url} title={drawer.title} /> : null}

              {drawer.kind === "image" ? <img className="drawer-image" src={drawer.url} alt={drawer.title} /> : null}

              {drawer.kind === "link" ? (
                <div className="drawer-link-card">
                  <p className="info-label">URL</p>
                  <p>
                    <a href={drawer.url} target="_blank" rel="noreferrer">
                      {drawer.url}
                    </a>
                  </p>
                  {drawer.text ? <p>{drawer.text}</p> : null}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </aside>
    </div>
  );
}
