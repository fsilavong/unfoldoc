# Unfoldoc

Unfoldoc is a markdown-native document format and reader for generated knowledge artifacts.

The goal is simple:

- keep the main document as normal markdown
- keep provenance in linked files instead of inline clutter
- let the UI open citations, sources, code, HTML, images, and JSON cleanly

Unfoldoc works well for agent-written research digests, RAG outputs, and source-backed notes.

## What It Looks Like

An Unfoldoc bundle is just a folder:

```text
my-doc/
  content.md
  citations/
    1.md
    2.json
  sources/
    prompt.txt
    summarise.py
  assets/
    chart.svg
```

`content.md` stays readable:

```md
# Weekly Digest

Grounded latent reasoning is the strongest theme in this batch [1](./citations/1.md).

The summary was generated from [this prompt](./sources/prompt.txt) and [this script](./sources/summarise.py).
```

The linked files carry the supporting material. Unfoldoc decides how to render them in the drawer.

## Core Ideas

- `content.md` is the primary artifact
- citations are normal relative links
- citation files can be markdown or JSON
- one citation file should usually represent one retrieved chunk
- source files, prompts, code, and assets are normal local files
- the reader upgrades the links; the writing format stays plain markdown

## Optional Source Doc

If you want a source document that points at a rendered artifact, Unfoldoc also understands a small fenced block:

~~~md
# Weekly Digest

```orbit
run: ./scripts/make_digest.sh
artifact: artifacts/hf-digest/content.md
```
~~~

Notes:

- `run:` is executed exactly as written in the shell
- `artifact:` points to the file the UI should render
- this execution metadata is optional; Unfoldoc bundles are still valid without it

## Quick Start

Materialize a source document:

```bash
uv run python -m unfoldoc.run unfoldoc/ui/public/docs/hf-digest.md
```

Run the reader UI:

```bash
cd unfoldoc/ui
npm install
npm run dev
```

## Use As A Skill

Agents can consume the writer skill directly from GitHub.

Raw skill file:

```text
https://raw.githubusercontent.com/fsilavong/unfoldoc/refs/heads/main/skills/write-unfoldoc/SKILL.md
```

Reference example file:

```text
https://raw.githubusercontent.com/fsilavong/unfoldoc/refs/heads/main/skills/write-unfoldoc/references/example_bundle.md
```

### Minimal path

For most agents, loading just `SKILL.md` is enough. It is written to be self-contained.

### Deep Agents

```python
from urllib.request import urlopen
from deepagents import create_deep_agent
from deepagents.backends.utils import create_file_data

skill_url = "https://raw.githubusercontent.com/fsilavong/unfoldoc/refs/heads/main/skills/write-unfoldoc/SKILL.md"
with urlopen(skill_url) as response:
    skill_content = response.read().decode("utf-8")

skills_files = {
    "/skills/write-unfoldoc/SKILL.md": create_file_data(skill_content)
}

agent = create_deep_agent(
    model="openai:gpt-5.4",
    skills=["/skills/"],
)
```

### Enhanced path

If you want to give the agent one worked example as extra context, also load:

```text
https://raw.githubusercontent.com/fsilavong/unfoldoc/refs/heads/main/skills/write-unfoldoc/references/example_bundle.md
```

and mount it at:

```text
/skills/write-unfoldoc/references/example_bundle.md
```

### Google ADK

Google ADK does not use the same mounted skill filesystem pattern. The equivalent approach is to load the skill markdown and include it in the agent instruction.

```python
from urllib.request import urlopen
from google.adk.agents import Agent

skill_url = "https://raw.githubusercontent.com/fsilavong/unfoldoc/refs/heads/main/skills/write-unfoldoc/SKILL.md"
with urlopen(skill_url) as response:
    skill_content = response.read().decode("utf-8")

root_agent = Agent(
    model="gemini-2.5-flash",
    name="unfoldoc_writer",
    description="Writes output in the Unfoldoc format.",
    instruction=f"""Follow this writing contract exactly:\n\n{skill_content}""",
)
```

## Repository Layout

```text
unfoldoc/
  run.py
  skills/
    write-unfoldoc/
  ui/
```

- `run.py`: optional materializer for source docs with `orbit` blocks
- `skills/write-unfoldoc/`: agent-facing writing contract
- `ui/`: the Unfoldoc reader

## RAG-Friendly Citations

For RAG-style outputs, the citation file is the provenance object.

Good defaults:

- use markdown when the chunk is best read as prose
- use JSON when the chunk is better represented as structured data
- keep the file itself as the chunk identity instead of adding extra chunk metadata fields unless needed
