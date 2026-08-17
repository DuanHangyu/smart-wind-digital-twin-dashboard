#!/usr/bin/env python3
"""Create a labeled turbine detail contact sheet for the delivery document."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
RENDERS = ROOT / "renders"
REPORTS = ROOT / "reports"
FONT_PATH = "/System/Library/Fonts/STHeiti Medium.ttc"


def main() -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    font_title = ImageFont.truetype(FONT_PATH, 34)
    font_label = ImageFont.truetype(FONT_PATH, 26)
    items = [
        ("B08_turbine_detail_front.png", "01  正视 / FRONT"),
        ("B08_turbine_detail_side.png", "02  侧视 / SIDE"),
        ("B08_turbine_detail_threequarter.png", "03  透视 / THREE-QUARTER"),
    ]
    panel_size = 720
    gap = 18
    header = 86
    label_height = 54
    width = gap + len(items) * (panel_size + gap)
    height = header + panel_size + label_height + gap
    canvas = Image.new("RGB", (width, height), (5, 15, 16))
    draw = ImageDraw.Draw(canvas)
    draw.text((gap, 22), "B 艺术化风场地形 V3 · 风机建模细节三视图", fill=(103, 255, 241), font=font_title)
    for index, (filename, label) in enumerate(items):
        image = Image.open(RENDERS / filename).convert("RGB").resize((panel_size, panel_size), Image.Resampling.LANCZOS)
        x = gap + index * (panel_size + gap)
        canvas.paste(image, (x, header))
        draw.rectangle((x, header + panel_size, x + panel_size, header + panel_size + label_height), fill=(8, 31, 32))
        draw.text((x + 18, header + panel_size + 11), label, fill=(197, 255, 248), font=font_label)
    canvas.save(REPORTS / "turbine_detail_three_views.png", optimize=True)

    detail_height = 390
    detail_canvas = Image.new("RGB", (width, header + detail_height + label_height + gap), (5, 15, 16))
    detail_draw = ImageDraw.Draw(detail_canvas)
    detail_draw.text((gap, 22), "V3 · 叶轮、轮毂与机舱细节对照", fill=(103, 255, 241), font=font_title)
    for index, (filename, label) in enumerate(items):
        source = Image.open(RENDERS / filename).convert("RGB")
        crop = source.crop((110, 40, 890, 460)).resize((panel_size, detail_height), Image.Resampling.LANCZOS)
        x = gap + index * (panel_size + gap)
        detail_canvas.paste(crop, (x, header))
        detail_draw.rectangle((x, header + detail_height, x + panel_size, header + detail_height + label_height), fill=(8, 31, 32))
        detail_draw.text((x + 18, header + detail_height + 11), label, fill=(197, 255, 248), font=font_label)
    detail_canvas.save(REPORTS / "turbine_nacelle_detail_three_views.png", optimize=True)


if __name__ == "__main__":
    main()
