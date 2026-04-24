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
```

## Writing rules

- Keep the main narrative in `content.md`
- Use short inline citations like `[1](./citations/1.md)` or `[2](./citations/2.json)`
- Put the retrieved chunk text in the citation file itself
- Put code, prompts, and source files under `sources/`
- Use normal relative links only; do not invent custom citation syntax
- Do not require `run:` for the document to be valid. Treat execution metadata as optional and external to the main writing contract

## Citation file shape

A citation file should be the chunk record that fed the pipeline, kept readable:

```md
# Citation 1

Source: https://example.com/paper

> Exact retrieved chunk text that supported the generated paragraph.
```

The file path already gives the chunk identity. Keep the markdown body minimal and readable.

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

## When to read references

- For a complete worked example, read `references/example_bundle.md`
