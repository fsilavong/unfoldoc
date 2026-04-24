from __future__ import annotations

import argparse
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path


ORBIT_BLOCK_RE = re.compile(r"```orbit\s*([\s\S]*?)```", re.MULTILINE)


@dataclass
class OrbitBlock:
    raw: str
    run: str
    artifact: str


def parse_orbit_blocks(markdown: str) -> list[OrbitBlock]:
    blocks: list[OrbitBlock] = []
    for match in ORBIT_BLOCK_RE.finditer(markdown):
        raw = match.group(1)
        run = ""
        artifact = ""
        for line in raw.splitlines():
            trimmed = line.strip()
            if trimmed.startswith("run:"):
                run = trimmed[4:].strip()
            elif trimmed.startswith("artifact:"):
                artifact = trimmed[9:].strip()
        if run and artifact:
            blocks.append(OrbitBlock(raw=raw, run=run, artifact=artifact))
    return blocks


def infer_artifact_root(doc_path: Path) -> Path:
    if doc_path.parent.name == "docs":
        return doc_path.parent.parent
    return doc_path.parent


def materialize_document(
    doc_path: Path,
    *,
    run_cwd: Path,
    artifact_root: Path | None = None,
) -> dict[str, object]:
    source = doc_path.read_text(encoding="utf-8")
    blocks = parse_orbit_blocks(source)
    resolved_artifact_root = (artifact_root or infer_artifact_root(doc_path)).resolve()

    results: list[dict[str, object]] = []
    for block in blocks:
        subprocess.run(
            block.run,
            cwd=run_cwd,
            check=True,
            text=True,
            shell=True,
        )
        artifact_path = (resolved_artifact_root / block.artifact).resolve()
        if not artifact_path.exists():
            raise FileNotFoundError(
                f"Artifact declared by orbit block was not created: {artifact_path}"
            )
        results.append(
            {
                "run": block.run,
                "artifact": block.artifact,
                "artifact_path": str(artifact_path),
            }
        )

    return {
        "document": str(doc_path.resolve()),
        "artifact_root": str(resolved_artifact_root),
        "blocks": results,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Materialize Unfoldoc docs by executing `orbit` blocks."
    )
    parser.add_argument("document", help="Path to the markdown source document.")
    parser.add_argument(
        "--artifact-root",
        help="Base directory used to resolve `artifact:` paths. Defaults to the docs parent.",
    )
    parser.add_argument(
        "--run-cwd",
        default=".",
        help="Working directory used to execute `run:` commands. Defaults to repo root.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    doc_path = Path(args.document).resolve()
    artifact_root = Path(args.artifact_root).resolve() if args.artifact_root else None
    run_cwd = Path(args.run_cwd).resolve()

    result = materialize_document(
        doc_path,
        run_cwd=run_cwd,
        artifact_root=artifact_root,
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
