#!/usr/bin/env python3
"""Create exact-camera V4/V5 and reference/V4/V5 turbine comparison boards."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
V4 = ROOT.parent / "B_artistic_windfarm_terrain_v4_surface_refined"
REPORTS = ROOT / "reports"
REFERENCE = ROOT / "source/reference/v5_exterior_turbine_proportion_reference.png"
FONT_PATH = "/System/Library/Fonts/STHeiti Medium.ttc"


def fitted(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    result = Image.new("RGB", size, (8, 13, 14))
    copy = image.convert("RGB")
    copy.thumbnail(size, Image.Resampling.LANCZOS)
    result.paste(copy, ((size[0] - copy.width) // 2, (size[1] - copy.height) // 2))
    return result


def terrain_comparison(font: ImageFont.FreeTypeFont, label_font: ImageFont.FreeTypeFont) -> None:
    panels = [
        (V4 / "renders/B08_export_ready.png", "V4 · 小叶轮 / R:H = 0.291"),
        (ROOT / "renders/B08_export_ready.png", "V5 · R:H = 0.681 / 地图整机 ×0.75"),
    ]
    width, panel_width, panel_height, header, footer, gap = 2040, 990, 630, 82, 62, 20
    canvas = Image.new("RGB", (width, header + panel_height + footer + gap), (3, 12, 13))
    draw = ImageDraw.Draw(canvas)
    draw.text((20, 21), "B 风场 V4 / V5 同相机比例校正对比", font=font, fill=(93, 255, 238))
    for index, (path, label) in enumerate(panels):
        x = gap + index * (panel_width + gap)
        canvas.paste(fitted(Image.open(path), (panel_width, panel_height)), (x, header))
        draw.rectangle((x, header + panel_height, x + panel_width, header + panel_height + footer), fill=(7, 32, 33))
        draw.text((x + 18, header + panel_height + 14), label, font=label_font, fill=(211, 255, 249))
    canvas.save(REPORTS / "render_v4_v5_turbine_proportion_comparison.png", optimize=True)


def detail_comparison(font: ImageFont.FreeTypeFont, label_font: ImageFont.FreeTypeFont) -> None:
    reference = Image.open(REFERENCE).convert("RGB")
    # The upper-left cell is the locked exterior front view supplied by the user.
    reference_front = reference.crop((0, 0, reference.width // 3, reference.height // 2))
    panels = [
        (reference_front, "参考正视 · 长叶片 / 修长塔筒"),
        (Image.open(V4 / "renders/B08_turbine_detail_front.png"), "V4 · 叶片明显偏短"),
        (Image.open(ROOT / "renders/B08_turbine_detail_front.png"), "V5 · R:H = 0.681 / 地图 ×0.75"),
    ]
    panel_size, header, footer, gap = 620, 82, 62, 18
    width = gap + len(panels) * (panel_size + gap)
    canvas = Image.new("RGB", (width, header + panel_size + footer + gap), (3, 12, 13))
    draw = ImageDraw.Draw(canvas)
    draw.text((gap, 21), "外观参考 → V4 问题 → V5 比例校正", font=font, fill=(93, 255, 238))
    for index, (source, label) in enumerate(panels):
        x = gap + index * (panel_size + gap)
        canvas.paste(fitted(source, (panel_size, panel_size)), (x, header))
        draw.rectangle((x, header + panel_size, x + panel_size, header + panel_size + footer), fill=(7, 32, 33))
        draw.text((x + 16, header + panel_size + 14), label, font=label_font, fill=(211, 255, 249))
    canvas.save(REPORTS / "turbine_reference_v4_v5_comparison.png", optimize=True)


def main() -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    terrain_comparison(
        ImageFont.truetype(FONT_PATH, 34),
        ImageFont.truetype(FONT_PATH, 25),
    )
    detail_comparison(
        ImageFont.truetype(FONT_PATH, 34),
        ImageFont.truetype(FONT_PATH, 24),
    )


if __name__ == "__main__":
    main()
