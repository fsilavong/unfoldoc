---
name: write-unfoldoc
description: Use this skill when an agent needs to write documents in the Unfoldoc format for Orbit or other systems. It teaches the required folder shape, how to write `content.md`, how to link citations and local source files, and when to avoid execution-oriented metadata. Prefer this skill whenever the goal is to produce an Unfoldoc-compatible markdown bundle that the Unfoldoc UI can render.
---

# Write Unfoldoc

Write plain markdown first. Put supporting material in files. Link everything relatively. Let Unfoldoc render the links.

## Core contract

- The primary artifact is `content.md`
- `content.md` should read like normal markdown
- Citations should be normal markdown links to local files, usually under `./citations/`
- Citation files can be markdown or JSON
- Each citation file should usually represent the retrieved chunk that actually fed the downstream pipeline
- Source files should be normal markdown links to local files, usually under `./sources/`
- Images, HTML previews, and other assets can sit beside the markdown and be linked relatively
- Optional narration audio should live at `assets/narration.mp3` and be embedded from `content.md` with a fenced `audio` block

Minimal shape:

```text
artifact-folder/
  content.md
```

Common shape:

```text
artifact-folder/
  content.md
  citations/
    1.md
    2.md
    3.json
  sources/
    prompt.txt
    summarise.py
  assets/
    chart.svg
    narration.mp3
```

## Writing rules

- Keep the main narrative in `content.md`
- Use short inline citations like `[1](./citations/1.md)` or `[2](./citations/2.json)`
- Citation link text should be numeric only; do not use labels like `[source]`, `[abstract]`, or `[citation]`
- Put the retrieved chunk text in the citation file itself
- Put code, prompts, and source files under `sources/`
- Use normal relative links only; do not invent custom citation syntax
- Do not require `run:` for the document to be valid. Treat execution metadata as optional and external to the main writing contract
- Do not describe tool calls, interactive previews, truncation in the chat UI, hidden prompts, ledgers, or other execution details in `content.md`
- When a caller gives you a target output folder, write the bundle directly into that folder
- At minimum, write `content.md`
- When the evidence supports it, also write `citations/...` and `sources/...`
- If you already wrote the files successfully, keep the final chat response brief and just confirm what you created

## Optional audio narration

If a caller wants a narrated bundle, embed the saved audio file directly in `content.md` with a fenced `audio` block:

```audio
src: ./assets/narration.mp3
title: Listen
```

Rules:

- Keep the audio file inside the bundle, usually at `assets/narration.mp3`
- Use a normal relative path in `src:`
- Keep the rest of `content.md` as normal markdown
- Use this only when a real audio asset exists; do not add placeholder audio blocks

## Citation file shape

A citation file should be the chunk record that fed the pipeline, kept readable:

```md
# Example Paper

- Source: https://example.com/paper
- Title: Example Paper

## Evidence

> Exact retrieved chunk text that supported the generated paragraph.
```

The file path already gives the chunk identity. Keep the markdown body minimal and readable.

Formatting rules for citation markdown:

- Prefer a descriptive title header over `# Citation N`
- Put metadata in short bullet lines, not loose `Source:` paragraphs
- Use an `## Evidence` section for supporting text
- Preserve paragraph breaks when quoting evidence; do not collapse long text into one giant paragraph
- Include only the minimal retrieved excerpt needed to support the cited claim, not the entire source by default
- If there are two distinct supporting excerpts, use two short blockquotes rather than one long dump
- For email citations, include sender, subject, and date in the metadata bullets

## JSON citation shape

If the chunk is better represented as structured data, use JSON:

```json
{
  "source": "https://example.com/paper",
  "title": "Example Paper",
  "text": "Exact retrieved chunk text that supported the generated paragraph."
}
```

Unfoldoc renders JSON citations in a wrapped structured view in the drawer.

## Source file examples

- `./sources/summarise.py`
- `./sources/prompt.txt`
- `./assets/chart.svg`
- `./preview.html`

Unfoldoc should decide how to open the linked file in the drawer.

For RAG-style outputs, the citation file is the primary provenance object, not a generic footnote. Use markdown for prose chunks and JSON for structured chunk objects.

## Source-note digest pattern

When an agent writes source-level notes from fetched posts, RSS entries, abstracts, or retrieved chunks:

- Create local citation files under `citations/` for the retrieved chunks or item records that support the notes
- Cite claims in `content.md` with normal relative links to those local citation files, for example `[1](./citations/1.md)`
- Use numeric citation labels only, like `[1]`, `[2]`, and `[3]`
- Each citation file should include the original URL, title, and retrieved text or abstract that directly supports the claim
- Keep citation files compact and scannable: title header, short metadata bullets, then only the necessary evidence excerpt
- Do not rely on a generic source list alone; put citations next to the claims they support
- If only a snippet or metadata record was retrieved, make that limitation visible in the note and citation file

## Multi-stage digest pattern

When a final digest synthesizes outputs from other agents, cite the upstream agent artifacts directly instead of inventing new provenance:

- Link to each upstream `content.md` with a normal relative markdown link
- Treat that upstream `content.md` as the source summary that supports the synthesis
- Do not copy all upstream text into the final bundle unless needed
- Keep final `content.md` as the only top-level narrative
- Example final citation: `[Anthropic alignment summary](../../blog-digest/anthropic-alignment/content.md)`

This keeps drill-down intact: the reader can open the final digest, click into the source-agent summary, then follow that summary's own citations or source links.

## Minimal example

```md
# Weekly Digest

Grounded latent reasoning is the strongest theme in this batch [1](./citations/1.md).

The summary was generated from [this prompt](./sources/prompt.txt).
```

With:

- `citations/1.md`
- `sources/prompt.txt`

That is already a valid Unfoldoc bundle.
