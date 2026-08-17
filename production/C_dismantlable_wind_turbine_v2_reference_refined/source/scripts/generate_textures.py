#!/usr/bin/env python3
"""Create a compact shared PBR atlas for the dismantlable turbine."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "textures" / "png"
REPORTS = ROOT / "reports"
SIZE = 1024
GRID = 4
CELL = SIZE // GRID
RNG = np.random.default_rng(20260817)

ZONES = {
    "white_composite": {"cell": [0, 0], "color": [218, 224, 225], "roughness": 126, "metallic": 0},
    "blue_machine": {"cell": [1, 0], "color": [42, 98, 174], "roughness": 104, "metallic": 28},
    "red_transmission": {"cell": [2, 0], "color": [176, 50, 47], "roughness": 112, "metallic": 34},
    "black_steel": {"cell": [3, 0], "color": [25, 31, 34], "roughness": 92, "metallic": 210},
    "silver_plate": {"cell": [0, 1], "color": [151, 158, 159], "roughness": 96, "metallic": 192},
    "dark_steel": {"cell": [1, 1], "color": [55, 64, 68], "roughness": 80, "metallic": 230},
    "cyan_glass_guide": {"cell": [2, 1], "color": [35, 174, 183], "roughness": 34, "metallic": 12},
    "rubber_seal": {"cell": [3, 1], "color": [19, 24, 27], "roughness": 176, "metallic": 0},
}


def smooth_noise(scale: int, radius: float) -> np.ndarray:
    small = RNG.random((scale, scale), dtype=np.float32)
    im = Image.fromarray(np.uint8(small * 255), "L").resize((SIZE, SIZE), Image.Resampling.BICUBIC)
    return np.asarray(im.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32) / 255.0


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    base = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    rough = np.full((SIZE, SIZE), 145, dtype=np.float32)
    metal = np.zeros((SIZE, SIZE), dtype=np.float32)
    ao = np.full((SIZE, SIZE), 244, dtype=np.float32)
    normal = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    normal[:, :, :] = (128, 128, 255)
    low_noise = smooth_noise(48, 1.1) - 0.5
    micro = smooth_noise(160, 0.35) - 0.5
    for name, cfg in ZONES.items():
        cx, cy = cfg["cell"]
        ys = slice(cy * CELL, (cy + 1) * CELL)
        xs = slice(cx * CELL, (cx + 1) * CELL)
        color = np.asarray(cfg["color"], dtype=np.float32)
        n = low_noise[ys, xs] * 7.0 + micro[ys, xs] * 3.5
        base[ys, xs] = np.clip(color + n[..., None], 0, 255)
        rough[ys, xs] = np.clip(cfg["roughness"] + n * 1.8, 16, 240)
        metal[ys, xs] = cfg["metallic"]
        ao[ys, xs] = np.clip(246 + low_noise[ys, xs] * 12, 220, 255)
        gx = np.gradient(micro[ys, xs], axis=1)
        gy = np.gradient(micro[ys, xs], axis=0)
        normal[ys, xs, 0] = np.clip(128 - gx * 90, 0, 255)
        normal[ys, xs, 1] = np.clip(128 + gy * 90, 0, 255)

    # Remaining atlas cells duplicate neutral white to keep every UV sample valid.
    for cy in range(GRID):
        for cx in range(GRID):
            if any(v["cell"] == [cx, cy] for v in ZONES.values()):
                continue
            ys = slice(cy * CELL, (cy + 1) * CELL)
            xs = slice(cx * CELL, (cx + 1) * CELL)
            base[ys, xs] = np.asarray([206, 213, 214]) + low_noise[ys, xs, None] * 5
            rough[ys, xs] = 132
            ao[ys, xs] = 244

    # Cell-safe inset frames make UV cell leakage immediately visible without becoming a texture seam.
    for i in range(1, GRID):
        base[:, i * CELL - 1:i * CELL + 1] *= 0.92
        base[i * CELL - 1:i * CELL + 1, :] *= 0.92

    base_u8 = np.uint8(np.clip(base, 0, 255))
    rough_u8 = np.uint8(np.clip(rough, 0, 255))
    metal_u8 = np.uint8(np.clip(metal, 0, 255))
    ao_u8 = np.uint8(np.clip(ao, 0, 255))
    normal_u8 = np.uint8(np.clip(normal, 0, 255))
    orm = np.dstack([ao_u8, rough_u8, metal_u8])
    Image.fromarray(base_u8, "RGB").save(OUT / "C_Turbine_BaseColor.png", optimize=True)
    Image.fromarray(normal_u8, "RGB").save(OUT / "C_Turbine_Normal_Source.png", optimize=True)
    Image.fromarray(normal_u8, "RGB").save(OUT / "C_Turbine_Normal.png", optimize=True)
    Image.fromarray(ao_u8, "L").save(OUT / "C_Turbine_AO_Source.png", optimize=True)
    Image.fromarray(ao_u8, "L").save(OUT / "C_Turbine_AO.png", optimize=True)
    Image.fromarray(rough_u8, "L").save(OUT / "C_Turbine_Roughness.png", optimize=True)
    Image.fromarray(metal_u8, "L").save(OUT / "C_Turbine_Metallic.png", optimize=True)
    Image.fromarray(orm, "RGB").save(OUT / "C_Turbine_ORM_Source.png", optimize=True)
    Image.fromarray(orm, "RGB").save(OUT / "C_Turbine_ORM.png", optimize=True)

    checker = Image.new("RGB", (SIZE, SIZE), (19, 24, 28))
    d = ImageDraw.Draw(checker)
    step = 64
    for y in range(0, SIZE, step):
        for x in range(0, SIZE, step):
            c = (33, 150, 156) if (x // step + y // step) % 2 == 0 else (222, 226, 225)
            d.rectangle((x, y, x + step - 1, y + step - 1), fill=c)
    for y in range(0, SIZE + 1, CELL): d.line((0, y, SIZE, y), fill=(255, 82, 82), width=4)
    for x in range(0, SIZE + 1, CELL): d.line((x, 0, x, SIZE), fill=(255, 82, 82), width=4)
    checker.save(OUT / "C_Turbine_UV_Checker.png", optimize=True)

    board = Image.new("RGB", (1400, 760), (8, 18, 20))
    bd = ImageDraw.Draw(board)
    bd.text((36, 24), "C | Dismantlable turbine shared PBR atlas", fill=(101, 236, 231))
    atlas = Image.fromarray(base_u8, "RGB").resize((640, 640))
    board.paste(atlas, (36, 82))
    y = 92
    for name, cfg in ZONES.items():
        color = tuple(cfg["color"])
        bd.rounded_rectangle((730, y, 780, y + 38), radius=8, fill=color, outline=(95, 224, 218))
        bd.text((800, y + 8), f"{name} | cell {cfg['cell']} | R {cfg['roughness']} | M {cfg['metallic']}", fill=(218, 232, 231))
        y += 70
    board.save(REPORTS / "material_atlas_breakdown.png", optimize=True)
    manifest = {"size": SIZE, "grid": GRID, "cell_size": CELL, "zones": ZONES,
                "maps": [p.name for p in sorted(OUT.glob("C_Turbine_*.png"))]}
    (REPORTS / "texture_generation.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
