# Unfoldoc UI

This is the reader for Unfoldoc bundles.

It:

- loads source markdown docs
- expands optional `orbit` blocks into linked artifacts
- renders markdown as the main reading surface
- renders fenced `audio` blocks as bundle-local audio players
- opens citations, source files, JSON, HTML, and images in the drawer

## Run

```bash
cd unfoldoc/ui
npm install
npm run dev
```

## Demo Data

Bundled examples live in:

- `public/examples.json`
- `public/docs/`
- `public/artifacts/`

## Local Workflow

Materialize the example source doc first:

```bash
uv run python -m unfoldoc.run unfoldoc/ui/public/docs/hf-digest.md
```

Then start the UI and inspect the rendered result.
