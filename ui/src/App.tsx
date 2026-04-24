import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type DocumentRecord = {
  id: string;
  title: string;
  description?: string;
  source_url?: string;
  artifact_path: string;
};

type ExampleFile = {
  documents: DocumentRecord[];
};

type DrawerState =
  | { kind: "closed" }
  | { kind: "markdown"; title: string; markdown: string }
  | { kind: "json"; title: string; value: unknown }
  | { kind: "code"; title: string; language: string; text: string }
  | { kind: "html"; title: string; url: string }
  | { kind: "image"; title: string; url: string }
  | { kind: "link"; title: string; url: string; text?: string };

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

function isTextExtension(ext: string): boolean {
  return ["py", "js", "mjs", "ts", "tsx", "jsx", "md", "txt", "json", "yaml", "yml", "csv", "log"].includes(ext);
}

function isHtmlExtension(ext: string): boolean {
  return ext === "html" || ext === "htm";
}

function resolveArtifactUrl(artifactPath: string, href: string): string {
  return new URL(href, `${window.location.origin}/${artifactPath}`).pathname;
}

type OrbitBlock = {
  raw: string;
  run?: string;
  artifact?: string;
};

function parseOrbitBlock(rawBlock: string): OrbitBlock {
  const block: OrbitBlock = { raw: rawBlock };
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

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function absolutizeMarkdownLinks(markdown: string, artifactPath: string): string {
  return markdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    if (
      href.startsWith("http://") ||
      href.startsWith("https://") ||
      href.startsWith("#")
    ) {
      return `[${label}](${href})`;
    }
    const resolved = resolveArtifactUrl(artifactPath, href);
    return `[${label}](${resolved})`;
  }).replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, label, href) => {
    if (
      href.startsWith("http://") ||
      href.startsWith("https://") ||
      href.startsWith("#")
    ) {
      return `![${label}](${href})`;
    }
    const resolved = resolveArtifactUrl(artifactPath, href);
    return `![${label}](${resolved})`;
  });
}

async function expandOrbitBlocks(sourceMarkdown: string): Promise<string> {
  const blockRegex = /```orbit\s*([\s\S]*?)```/g;
  const matches = [...sourceMarkdown.matchAll(blockRegex)];
  if (matches.length === 0) {
    return sourceMarkdown;
  }

  let rendered = sourceMarkdown;
  for (const match of matches) {
    const rawBody = match[1];
    const block = parseOrbitBlock(rawBody);
    if (!block.artifact) {
      continue;
    }

    const response = await fetch(`/${block.artifact}`);
    if (!response.ok) {
      throw new Error(`Failed to load orbit artifact: ${response.status}`);
    }

    const ext = extensionFromPath(block.artifact);
    if (ext !== "md") {
      const replacement = [
        `> Orbit artifact: \`${block.artifact}\``,
        block.run ? `> Run: \`${block.run}\`` : "",
        "",
      ].filter(Boolean).join("\n");
      rendered = rendered.replace(match[0], replacement);
      continue;
    }

    const artifactMarkdown = await response.text();
    const expandedArtifact = absolutizeMarkdownLinks(artifactMarkdown, block.artifact);
    rendered = rendered.replace(match[0], expandedArtifact);
  }

  return rendered;
}

export default function App() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>("");
  const [sourceMarkdown, setSourceMarkdown] = useState<string>("");
  const [markdown, setMarkdown] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [drawer, setDrawer] = useState<DrawerState>({ kind: "closed" });
  const [hoveredCitation, setHoveredCitation] = useState<{ title: string; text: string } | null>(null);
  const [light, setLight] = useState<boolean>(() => localStorage.getItem("theme") === "light");
  const [debugTab, setDebugTab] = useState<"rendered" | "source">("rendered");

  useEffect(() => {
    document.documentElement.classList.toggle("light", light);
    localStorage.setItem("theme", light ? "light" : "dark");
  }, [light]);

  useEffect(() => {
    fetch("/examples.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load Unfoldoc examples: ${response.status}`);
        }
        return response.json();
      })
      .then((data: ExampleFile) => {
        setDocuments(data.documents);
        const first = data.documents[0];
        if (first) {
          setSelectedDocumentId(first.id);
        }
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const selectedDoc = documents.find((item) => item.id === selectedDocumentId) ?? null;

  useEffect(() => {
    if (!selectedDoc) {
      return;
    }
    fetch(`/${selectedDoc.artifact_path}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load artifact: ${response.status}`);
        }
        return response.text();
      })
      .then((text) => {
        setSourceMarkdown(text);
        return expandOrbitBlocks(text);
      })
      .then((text) => {
        setMarkdown(text);
        setDrawer({ kind: "closed" });
        setHoveredCitation(null);
        setDebugTab("rendered");
      })
      .catch((err: Error) => setError(err.message));
  }, [selectedDoc]);

  const localCitationCount = useMemo(() => {
    const matches = markdown.match(/\]\((?:\.\/)?citations\/[^)]+\.(?:md|json)\)/g);
    return matches ? matches.length : 0;
  }, [markdown]);

  async function openLinkedResource(href: string, label: string) {
    if (!selectedDoc) {
      return;
    }

    if (/^https?:\/\//.test(href)) {
      setDrawer({
        kind: "link",
        title: label || href,
        url: href,
        text: "Remote URLs stay as links in the drawer. Orbit can enrich these later with fetched metadata or cached source content.",
      });
      return;
    }

    const resolvedPath = resolveArtifactUrl(selectedDoc.artifact_path, href);
    const ext = extensionFromPath(resolvedPath);

    if (isImageExtension(ext)) {
      setDrawer({ kind: "image", title: label || href, url: resolvedPath });
      return;
    }

    if (isHtmlExtension(ext)) {
      setDrawer({ kind: "html", title: label || href, url: resolvedPath });
      return;
    }

    if (isTextExtension(ext)) {
      const response = await fetch(resolvedPath);
      const text = await response.text();
      if (ext === "md") {
        setDrawer({ kind: "markdown", title: label || href, markdown: text });
        return;
      }
      if (ext === "json") {
        setDrawer({ kind: "json", title: label || href, value: tryParseJson(text) });
        return;
      }
      setDrawer({
        kind: "code",
        title: label || href,
        language: languageFromExtension(ext),
        text,
      });
      return;
    }

    setDrawer({ kind: "link", title: label || href, url: resolvedPath });
  }

  async function previewCitation(href: string, label: string) {
    if (!selectedDoc) {
      return;
    }
    if (!href.includes("citations/")) {
      return;
    }
    const resolvedPath = resolveArtifactUrl(selectedDoc.artifact_path, href);
    const response = await fetch(resolvedPath);
    if (!response.ok) {
      return;
    }
    const text = await response.text();
    if (extensionFromPath(href) === "json") {
      setHoveredCitation({ title: label, text: JSON.stringify(tryParseJson(text), null, 2) });
      return;
    }
    setHoveredCitation({ title: label, text });
  }

  if (error) {
    return <main className="loading-state">Failed to load: {error}</main>;
  }

  if (!selectedDoc) {
    return <main className="loading-state">Loading Unfoldoc…</main>;
  }

  return (
    <div className="app">
      <aside className="left">
        <div className="left-hdr">
          <div className="gdot" />
          <h2>Unfoldoc</h2>
          <button type="button" className="theme-btn" onClick={() => setLight((value) => !value)}>
            {light ? "Dark" : "Light"}
          </button>
        </div>

        <div className="search-wrap">
          <div className="sidebar-copy">
            Unfoldoc treats markdown as the artifact. Orbit can generate these docs, and this renderer opens
            local files, HTML, images, or local citation files in the drawer.
          </div>
        </div>

        <div className="tree-scroll">
          {documents.map((item) => {
            const active = item.id === selectedDoc.id;
            return (
              <button
                key={item.id}
                type="button"
                className={active ? "doc-row active" : "doc-row"}
                onClick={() => setSelectedDocumentId(item.id)}
              >
                <div className="doc-row-main">
                  <div className="doc-row-title">{item.title}</div>
                  <div className="doc-row-desc">{item.description || item.source_url || item.id}</div>
                </div>
                <div className="doc-row-meta">{item.artifact_path}</div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="right">
        <div className="banner">
          <div className="banner-row1">
            <span className="banner-ticker">UNFOLDOC</span>
            <span className="banner-coname">{selectedDoc.title}</span>
          </div>
          <div className="banner-row2">
            {selectedDoc.source_url ? (
              <span className="meta">
                Source:
                <span>
                  <a href={selectedDoc.source_url} target="_blank" rel="noreferrer">
                    {selectedDoc.source_url}
                  </a>
                </span>
              </span>
            ) : null}
            <span className="meta">·</span>
            <span className="meta">
              Artifact:
              <span>{selectedDoc.artifact_path}</span>
            </span>
            <span className="meta">·</span>
            <span className="meta">
              Local citations:
              <span>{localCitationCount}</span>
            </span>
          </div>
        </div>

        <div className="viewer-shell">
          <section className="viewer-pane">
            <div className="panel-header">
              <h2>Unfoldoc</h2>
              <div className="tab-strip">
                <button
                  type="button"
                  className={debugTab === "rendered" ? "tab-btn active" : "tab-btn"}
                  onClick={() => setDebugTab("rendered")}
                >
                  Rendered
                </button>
                <button
                  type="button"
                  className={debugTab === "source" ? "tab-btn active" : "tab-btn"}
                  onClick={() => setDebugTab("source")}
                >
                  Source
                </button>
              </div>
            </div>
            {debugTab === "rendered" ? (
              <article className="content markdown-content md-body">
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
                    return (
                      <button
                        type="button"
                        className={isLocalCitation ? "citation" : "md-link-button"}
                        onClick={() => href && void openLinkedResource(href, label)}
                        onMouseEnter={() => {
                          if (!href || !isLocalCitation) {
                            return;
                          }
                          void previewCitation(href, label);
                        }}
                        onMouseLeave={() => setHoveredCitation(null)}
                        title={label}
                      >
                        {isLocalCitation ? label.replace(/[^\d]/g, "") || label : children}
                      </button>
                    );
                  },
                  }}
                >
                  {markdown}
                </ReactMarkdown>
              </article>
            ) : (
              <pre className="content source-debug">{sourceMarkdown}</pre>
            )}
          </section>
        </div>
      </section>

      {hoveredCitation && drawer.kind === "closed" ? (
        <div className="citation-hover-card" role="note">
          <p className="info-label">Citation Preview</p>
          <strong>{hoveredCitation.title}</strong>
          <p>{hoveredCitation.text}</p>
        </div>
      ) : null}

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
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{drawer.markdown}</ReactMarkdown>
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

              {drawer.kind === "html" ? (
                <iframe className="drawer-frame" src={drawer.url} title={drawer.title} />
              ) : null}

              {drawer.kind === "image" ? (
                <img className="drawer-image" src={drawer.url} alt={drawer.title} />
              ) : null}

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
