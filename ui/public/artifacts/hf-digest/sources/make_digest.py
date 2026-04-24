from __future__ import annotations

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "ui" / "app" / "public" / "artifacts" / "hf-digest"
SCRIPT_COPY = ARTIFACT_DIR / "sources" / "make_digest.py"


CONTENT = """# Hugging Face Papers Digest

Today's batch clusters around grounded latent reasoning and richer agent training environments [1](./citations/citation-1.md) [2](./citations/citation-2.md).

## Why this batch matters

The strongest signal is that agent progress is increasingly coming from better internal structure and better training arenas, not just larger base models. The markdown artifact can still link directly to the generating script [digest script](./sources/make_digest.py).

## Worth reading

- [OneVL paper page](https://huggingface.co/papers/2604.18486)
- [Agent-World paper page](https://huggingface.co/papers/2604.18292)
"""


CITATION_ONE = """# Citation 1

Source: https://huggingface.co/papers/2604.18486

> OneVL combines latent reasoning with grounded future-state supervision so planning stays tied to the visual world.
"""


CITATION_TWO = """# Citation 2

Source: https://huggingface.co/papers/2604.18292

> Agent-World focuses on generating richer executable training environments so agents keep improving against new arenas.
"""


def main() -> int:
    (ARTIFACT_DIR / "citations").mkdir(parents=True, exist_ok=True)
    (ARTIFACT_DIR / "sources").mkdir(parents=True, exist_ok=True)

    (ARTIFACT_DIR / "content.md").write_text(CONTENT, encoding="utf-8")
    (ARTIFACT_DIR / "citations" / "citation-1.md").write_text(CITATION_ONE, encoding="utf-8")
    (ARTIFACT_DIR / "citations" / "citation-2.md").write_text(CITATION_TWO, encoding="utf-8")
    shutil.copy2(Path(__file__), SCRIPT_COPY)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

