# Example Unfoldoc Bundle

Folder:

```text
hf-digest/
  content.md
  citations/
    1.md
    2.json
  sources/
    prompt.txt
    summarise.py
```

`content.md`

```md
# Weekly Digest

Grounded latent reasoning is the strongest theme in this batch [1](./citations/1.md).

The summary was generated from [this prompt](./sources/prompt.txt) and [this script](./sources/summarise.py). A structured retrieval object can also be linked as [2](./citations/2.json).
```

`citations/1.md`

```md
# Citation 1

Source: https://huggingface.co/papers/2604.18486

> Retrieved chunk text lives here.
```

`sources/prompt.txt`

```text
Summarise the latest papers for a research lead. Focus on what is materially new.
```

`citations/2.json`

```json
{
  "source": "https://huggingface.co/papers/2604.18292",
  "title": "Agent-World",
  "text": "Retrieved chunk text lives here."
}
```

Notes:

- `content.md` is the only required top-level content file
- citations are file-backed, not anchor-backed
- each citation file should correspond to the retrieved chunk that fed the generation pipeline
- the citation contents live in those separate files; `content.md` should only link to them
- the bundle is valid even if there is no execution metadata
