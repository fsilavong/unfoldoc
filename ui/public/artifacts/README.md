# Artifact Folder Shape

Orbit treats each artifact folder like a small package.

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
    citation-1.md
  sources/
    script.py
  chart.svg
  preview.html
```

Rules:

- `content.md` is the main file the renderer loads
- links inside `content.md` drive the drawer behavior
- `citations/*.md` are local citation files opened in the drawer
- `sources/*` are local source files such as scripts or prompts
- other files like images or HTML previews can sit beside the markdown

Source docs reference these artifacts with an `orbit` block:

~~~md
```orbit
run: ./scripts/make_digest.sh
artifact: artifacts/hf-digest/content.md
```
~~~

The local materializer runs the command, then verifies that the referenced artifact exists.
