#!/usr/bin/env python3
"""Bake Tiled .tmx to PNG(s) + collision/overhead JSON for the web dashboard."""

from __future__ import annotations

import csv
import io
import json
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image

FLIP_H = 0x80000000
FLIP_V = 0x40000000
FLIP_D = 0x20000000
GID_MASK = 0x1FFFFFFF

COLLISION_LAYERS = {"walls", "walls-front", "furniture_mid", "stuff"}
OVERHEAD_LAYERS = {"furniture_high", "stuff 2"}
WALKOVER_LAYERS = {"furniture_low"}
MID_LAYERS = {"furniture_mid"}
WALLS_FRONT_LAYERS = {"walls-front"}
META_LAYERS = {"actions", "action"}
NON_RENDER_LAYERS = META_LAYERS


def norm(name: str) -> str:
    return name.strip().lower()


def parse_tileset_tsx(tsx_path: Path) -> dict:
    root = ET.parse(tsx_path).getroot()
    img_el = root.find("image")
    if img_el is None:
        raise ValueError(f"No image in {tsx_path}")
    image_path = (tsx_path.parent / img_el.get("source")).resolve()
    return {
        "tilewidth": int(root.get("tilewidth", 32)),
        "tileheight": int(root.get("tileheight", 32)),
        "columns": int(root.get("columns", 8)),
        "image": Image.open(image_path).convert("RGBA"),
    }


def load_tilesets(map_path: Path, map_root: ET.Element) -> list[tuple[int, dict]]:
    sets: list[tuple[int, dict]] = []
    for el in map_root.findall("tileset"):
        first_gid = int(el.get("firstgid", 1))
        tsx = (map_path.parent / el.get("source")).resolve()
        sets.append((first_gid, parse_tileset_tsx(tsx)))
    sets.sort(key=lambda x: x[0])
    return sets


def find_tileset(gid: int, tilesets: list[tuple[int, dict]]) -> tuple[dict, int] | None:
    clean = gid & GID_MASK
    chosen, local = None, 0
    for first_gid, ts in tilesets:
        if clean >= first_gid:
            chosen, local = ts, clean - first_gid
        else:
            break
    return (chosen, local) if chosen is not None and local >= 0 else None


def blit_tile(canvas, ts, local_id, dest_x, dest_y, flip_h, flip_v, flip_d):
    tw, th = ts["tilewidth"], ts["tileheight"]
    cols = ts["columns"]
    sx, sy = (local_id % cols) * tw, (local_id // cols) * th
    img = ts["image"]
    if sx + tw > img.width or sy + th > img.height:
        return
    tile = img.crop((sx, sy, sx + tw, sy + th))
    if flip_d:
        tile = tile.transpose(Image.Transpose.TRANSPOSE)
    if flip_h:
        tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if flip_v:
        tile = tile.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    canvas.alpha_composite(tile, (dest_x, dest_y))


def parse_layer_csv(layer_el) -> list[int]:
    data_el = layer_el.find("data")
    if data_el is None:
        return []
    text = (data_el.text or "").strip()
    return [int(x) for row in csv.reader(io.StringIO(text), skipinitialspace=True) for x in row if x]


def bake_layers(
    map_path: Path,
    tilesets,
    width: int,
    height: int,
    tw: int,
    th: int,
    include_layers: set[str] | None,
    exclude_layers: set[str],
) -> Image.Image:
    root = ET.parse(map_path).getroot()
    canvas = Image.new("RGBA", (width * tw, height * th), (0, 0, 0, 0))
    for layer_el in root.findall("layer"):
        if layer_el.get("visible") == "0":
            continue
        name = norm(layer_el.get("name", ""))
        if include_layers is not None and name not in include_layers:
            continue
        if name in exclude_layers:
            continue
        gids = parse_layer_csv(layer_el)
        if len(gids) != width * height:
            continue
        for idx, gid in enumerate(gids):
            if gid == 0:
                continue
            found = find_tileset(gid, tilesets)
            if not found:
                continue
            ts, local_id = found
            tx, ty = idx % width, idx // width
            blit_tile(
                canvas,
                ts,
                local_id,
                tx * tw,
                ty * th,
                bool(gid & FLIP_H),
                bool(gid & FLIP_V),
                bool(gid & FLIP_D),
            )
    return canvas


def build_grids(map_path: Path, width: int, height: int) -> tuple[list[int], list[int]]:
    blocked = [0] * (width * height)
    overhead = [0] * (width * height)
    root = ET.parse(map_path).getroot()
    for layer_el in root.findall("layer"):
        if layer_el.get("visible") == "0":
            continue
        name = norm(layer_el.get("name", ""))
        gids = parse_layer_csv(layer_el)
        if len(gids) != width * height:
            continue
        for idx, gid in enumerate(gids):
            if gid == 0:
                continue
            if name in COLLISION_LAYERS:
                blocked[idx] = 1
            elif name in OVERHEAD_LAYERS:
                overhead[idx] = 1
    return blocked, overhead



def export_layer_tiles(map_path: Path, width: int, height: int, layer_names: set[str]) -> list[dict]:
    root = ET.parse(map_path).getroot()
    tiles: list[dict] = []
    for layer_el in root.findall("layer"):
        if layer_el.get("visible") == "0":
            continue
        name = norm(layer_el.get("name", ""))
        if name not in layer_names:
            continue
        gids = parse_layer_csv(layer_el)
        if len(gids) != width * height:
            continue
        for idx, gid in enumerate(gids):
            if gid == 0:
                continue
            tx, ty = idx % width, idx // width
            tiles.append({"x": tx, "y": ty, "gid": gid & GID_MASK, "gidRaw": gid})
    return tiles


def export_actions(map_path: Path, width: int, height: int, tilesets: list[tuple[int, dict]]) -> list[dict]:
    items = export_layer_tiles(map_path, width, height, META_LAYERS)
    for item in items:
        found = find_tileset(item["gidRaw"], tilesets)
        if found:
            ts, local_id = found
            item["localTileId"] = local_id
    return items


def export_all(map_path: Path, out_dir: Path) -> None:
    tree = ET.parse(map_path)
    root = tree.getroot()
    width = int(root.get("width"))
    height = int(root.get("height"))
    tw = int(root.get("tilewidth", 32))
    th = int(root.get("tileheight", 32))
    tilesets = load_tilesets(map_path, root)
    out_dir.mkdir(parents=True, exist_ok=True)

    base_exclude = (
        OVERHEAD_LAYERS | WALKOVER_LAYERS | MID_LAYERS | WALLS_FRONT_LAYERS | NON_RENDER_LAYERS
    )
    base = bake_layers(map_path, tilesets, width, height, tw, th, None, base_exclude)
    mid = bake_layers(map_path, tilesets, width, height, tw, th, MID_LAYERS, set())
    walls_front = bake_layers(map_path, tilesets, width, height, tw, th, WALLS_FRONT_LAYERS, set())
    walkover = bake_layers(map_path, tilesets, width, height, tw, th, WALKOVER_LAYERS, set())
    overlay = bake_layers(map_path, tilesets, width, height, tw, th, OVERHEAD_LAYERS, set())

    base_path = out_dir / "dashboard-v1-baked.png"
    mid_path = out_dir / "dashboard-v1-mid.png"
    walls_front_path = out_dir / "dashboard-v1-walls-front.png"
    walkover_path = out_dir / "dashboard-v1-walkover.png"
    overlay_path = out_dir / "dashboard-v1-overlay.png"
    base.save(base_path)
    mid.save(mid_path)
    walls_front.save(walls_front_path)
    walkover.save(walkover_path)
    overlay.save(overlay_path)

    mid_tiles = export_layer_tiles(map_path, width, height, MID_LAYERS)
    walls_front_tiles = export_layer_tiles(map_path, width, height, WALLS_FRONT_LAYERS)
    walkover_tiles = export_layer_tiles(map_path, width, height, WALKOVER_LAYERS)
    action_tiles = export_actions(map_path, width, height, tilesets)
    blocked, overhead = build_grids(map_path, width, height)
    for tx in range(width):
        blocked[tx] = 1
        blocked[(height - 1) * width + tx] = 1
    for ty in range(height):
        blocked[ty * width] = 1
        blocked[ty * width + (width - 1)] = 1
    collision_rev = str(int(time.time()))
    meta = {
        "width": width,
        "height": height,
        "tileSize": tw,
        "blocked": blocked,
        "overhead": overhead,
        "collisionRev": collision_rev,
        "collisionLayers": sorted(COLLISION_LAYERS),
        "overheadLayers": sorted(OVERHEAD_LAYERS),
        "walkOverLayers": sorted(WALKOVER_LAYERS),
        "walkoverTiles": walkover_tiles,
        "midLayers": sorted(MID_LAYERS),
        "midTiles": [{"x": t["x"], "y": t["y"]} for t in mid_tiles],
        "wallsFrontLayers": sorted(WALLS_FRONT_LAYERS),
        "wallsFrontTiles": [{"x": t["x"], "y": t["y"]} for t in walls_front_tiles],
    }
    meta_path = out_dir / "dashboard-v1-collision.json"
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")

    actions_path = out_dir / "dashboard-v1-actions.json"
    actions_path.write_text(
        json.dumps(
            {
                "width": width,
                "height": height,
                "tileSize": tw,
                "layer": "actions",
                "tiles": action_tiles,
            },
            indent=2,
        )
        + "\n"
    )

    manifest_path = out_dir.parent / "manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text())
        manifest.setdefault("map", {})["collisionRev"] = collision_rev
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    print(f"Base: {base_path} ({base.size[0]}x{base.size[1]})")
    print(f"Mid: {mid_path} ({len(mid_tiles)} tiles)")
    print(f"Walls front: {walls_front_path} ({len(walls_front_tiles)} tiles)")
    print(f"Overlay: {overlay_path}")
    print(f"Walkover: {walkover_path} ({len(walkover_tiles)} tiles)")
    print(f"Actions: {actions_path} ({len(action_tiles)} tiles)")
    print(f"Meta: {meta_path} ({sum(blocked)} blocked, {sum(overhead)} overhead tiles)")


if __name__ == "__main__":
    default_tmx = Path("/Users/aaron/Documents/2026/Dashboard/Dashboard/dashboard-v1.tmx")
    default_out = Path(__file__).resolve().parent.parent / "public/assets/maps"
    tmx = Path(sys.argv[1]) if len(sys.argv) > 1 else default_tmx
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else default_out
    export_all(tmx, out_dir)
