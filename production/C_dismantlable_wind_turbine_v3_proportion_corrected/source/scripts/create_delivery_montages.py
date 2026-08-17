#!/usr/bin/env python3
"""Create image-rich audit boards from immutable references and generated renders."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT=Path(__file__).resolve().parents[2]; REPORTS=ROOT/"reports"; RENDERS=ROOT/"renders"; REFS=ROOT/"source/reference"
REPORTS.mkdir(exist_ok=True)
FONT=ImageFont.load_default()
def panel(path,size,title):
    im=Image.open(path).convert("RGB"); im.thumbnail(size,Image.Resampling.LANCZOS)
    out=Image.new("RGB",size,(4,14,17)); x=(size[0]-im.width)//2; y=34+(size[1]-34-im.height)//2; out.paste(im,(x,y))
    d=ImageDraw.Draw(out);d.rectangle((0,0,size[0],32),fill=(4,28,31));d.text((12,10),title,fill=(91,235,226),font=FONT);d.rectangle((0,0,size[0]-1,size[1]-1),outline=(24,92,92));return out
def board(items,cols,cell,out,title):
    rows=(len(items)+cols-1)//cols; canvas=Image.new("RGB",(cols*cell[0],rows*cell[1]+50),(2,9,11));d=ImageDraw.Draw(canvas);d.text((18,18),title,fill=(102,241,232),font=FONT)
    for i,(path,label) in enumerate(items):canvas.paste(panel(path,cell,label),((i%cols)*cell[0],50+(i//cols)*cell[1]))
    canvas.save(out,optimize=True)
refs=[(REFS/f"0{i}_{name}",label) for i,name,label in [(1,"cutaway_six_views.png","R1 cutaway"),(2,"exploded_six_views.png","R2 exploded"),(3,"component_details.png","R3 components"),(4,"wireframe_six_views.png","R4 wireframe"),(5,"exterior_six_views.png","R5 exterior")]]
models=[(RENDERS/"C08_cutaway_detail.png","M1 cutaway"),(RENDERS/"C01_structure_breakdown.png","M2 exploded"),(RENDERS/"C04_highpoly_detail.png","M3 components"),(RENDERS/"C05_lowpoly_retopology.png","M4 wireframe"),(RENDERS/"C08_export_ready.png","M5 exterior")]
items=[]
for r,m in zip(refs,models):items.extend([r,m])
board(items,2,(800,520),REPORTS/"reference_vs_model_contact_sheet.png","C | Reference / model paired audit")
stages=[(RENDERS/f"C0{i}_{name}.png",f"C0{i} {name}") for i,name in [(1,"structure_breakdown"),(2,"base_shape"),(3,"shape_refined"),(4,"highpoly_detail"),(5,"lowpoly_retopology"),(6,"uv_unwrapped"),(7,"baked_pbr"),(8,"export_ready")]]
board(stages,4,(480,360),REPORTS/"pipeline_eight_stage_overview.png","C | Eight immutable Blender stages")
views=[(RENDERS/"C08_view_front.png","front"),(RENDERS/"C08_view_side.png","side"),(RENDERS/"C08_view_rear.png","rear"),(RENDERS/"C08_view_top.png","top"),(RENDERS/"C08_cutaway_detail.png","cutaway 3/4"),(RENDERS/"C08_cutaway_side.png","cutaway side")]
board(views,3,(600,450),REPORTS/"final_six_view_board.png","C | Final multi-view and cutaway review")
print("created",REPORTS/"reference_vs_model_contact_sheet.png")
