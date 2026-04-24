from __future__ import annotations

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "ui" / "app" / "public" / "artifacts" / "revenue-plot"
SCRIPT_COPY = ARTIFACT_DIR / "sources" / "plot_revenue.py"


CONTENT = """# Revenue Trend

![Revenue chart](./chart.svg)

Generated from [the plotting script](./sources/plot_revenue.py). The raw browser-facing preview is also available as [HTML](./preview.html).
"""


SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="840" height="420" viewBox="0 0 840 420" fill="none">
  <rect width="840" height="420" fill="#0B1119"/>
  <path d="M72 344L204 286L336 238L468 186L600 140L732 88" stroke="#F1B561" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="72" cy="344" r="8" fill="#F1B561"/>
  <circle cx="204" cy="286" r="8" fill="#F1B561"/>
  <circle cx="336" cy="238" r="8" fill="#F1B561"/>
  <circle cx="468" cy="186" r="8" fill="#F1B561"/>
  <circle cx="600" cy="140" r="8" fill="#F1B561"/>
  <circle cx="732" cy="88" r="8" fill="#F1B561"/>
  <text x="72" y="382" fill="#AEB8C8" font-size="18">Jan</text>
  <text x="204" y="382" fill="#AEB8C8" font-size="18">Feb</text>
  <text x="336" y="382" fill="#AEB8C8" font-size="18">Mar</text>
  <text x="468" y="382" fill="#AEB8C8" font-size="18">Apr</text>
  <text x="600" y="382" fill="#AEB8C8" font-size="18">May</text>
  <text x="732" y="382" fill="#AEB8C8" font-size="18">Jun</text>
  <text x="72" y="52" fill="#F5F7FB" font-size="28" font-family="Georgia">Revenue Trend</text>
</svg>
"""


HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Revenue Preview</title>
    <style>
      body { margin: 0; background: #0b1119; color: #f5f7fb; font: 16px/1.5 Georgia, serif; }
      main { max-width: 880px; margin: 0 auto; padding: 32px; }
      img { width: 100%; border-radius: 18px; border: 1px solid #1f2835; display: block; }
    </style>
  </head>
  <body>
    <main>
      <h1>Revenue Preview</h1>
      <p>This is the HTML version of the same generated chart.</p>
      <img src="./chart.svg" alt="Revenue chart" />
    </main>
  </body>
</html>
"""


def main() -> int:
    (ARTIFACT_DIR / "sources").mkdir(parents=True, exist_ok=True)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    (ARTIFACT_DIR / "content.md").write_text(CONTENT, encoding="utf-8")
    (ARTIFACT_DIR / "chart.svg").write_text(SVG, encoding="utf-8")
    (ARTIFACT_DIR / "preview.html").write_text(HTML, encoding="utf-8")
    shutil.copy2(Path(__file__), SCRIPT_COPY)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

