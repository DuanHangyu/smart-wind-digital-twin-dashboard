#!/usr/bin/env python3
"""Create a compact reference / V2 / V3 proportion review board."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
CELL = (720, 500)
FONT = ImageFont.load_default()
ITEMS = [
    (ROOT / "source/reference/06_exterior_proportion_lock.png", "REFERENCE | exterior proportion lock"),
    (ROOT / "source/reference/07_v2_current_comparison.png", "V2 | short rotor / heavy head"),
    (ROOT / "reports/final_six_view_board.png", "V3 | ratio corrected 0.6802"),
]

canvas = Image.new("RGB", (CELL[0] * 3, CELL[1] + 48), (2, 10, 12))
draw = ImageDraw.Draw(canvas)
draw.text((18, 17), "C TURBINE | PROPORTION CORRECTION AUDIT", fill=(100, 238, 231), font=FONT)
for index, (path, label) in enumerate(ITEMS):
    image = Image.open(path).convert("RGB")
    image.thumbnail((CELL[0] - 20, CELL[1] - 48), Image.Resampling.LANCZOS)
    panel = Image.new("RGB", CELL, (5, 17, 20))
    panel.paste(image, ((CELL[0] - image.width) // 2, 38 + (CELL[1] - 38 - image.height) // 2))
    pdraw = ImageDraw.Draw(panel)
    pdraw.rectangle((0, 0, CELL[0] - 1, CELL[1] - 1), outline=(22, 104, 103))
    pdraw.text((12, 13), label, fill=(102, 239, 231), font=FONT)
    canvas.paste(panel, (index * CELL[0], 48))

out = ROOT / "reports/proportion_reference_v2_v3.png"
canvas.save(out, optimize=True)
print(out)
