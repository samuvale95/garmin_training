#!/usr/bin/env python3
"""
Script to remove background from generated 3D illustrations using BRIA-RMBG-1.4 on Hugging Face via gradio_client.
Saves transparent WebP files directly into web/public/illustrazioni/ and archives full-res PNGs into web/assets-src/illustrazioni/.
"""

import os
import sys
from pathlib import Path
from PIL import Image
from gradio_client import Client, handle_file

# Directory configuration
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DOWNLOADS_DIR = Path.home() / "Downloads" / "images-training-garmin"
PUBLIC_DEST_DIR = PROJECT_ROOT / "web" / "public" / "illustrazioni"
SRC_DEST_DIR = PROJECT_ROOT / "web" / "assets-src" / "illustrazioni"

# Mapping downloaded filenames to app asset names
FILE_MAP = {
    "ChatGPT Image Sep 30, 2026, 07_45_22 PM.png": "loading",
    "ChatGPT Image Sep 30, 2026, 07_45_13 PM.png": "attesa",
    "ChatGPT Image Sep 30, 2026, 07_45_09 PM.png": "sync",
    "ChatGPT Image Sep 30, 2026, 07_45_05 PM.png": "strava_sync",
    "ChatGPT Image Sep 30, 2026, 07_44_58 PM.png": "corsa",
    "ChatGPT Image Sep 30, 2026, 07_44_54 PM.png": "fondo_lento",
    "ChatGPT Image Sep 30, 2026, 07_44_49 PM.png": "bici",
    "ChatGPT Image Sep 30, 2026, 07_44_46 PM.png": "forza",
    "ChatGPT Image Sep 30, 2026, 07_44_42 PM.png": "riposo",
    "ChatGPT Image Sep 30, 2026, 07_44_37 PM.png": "esultanza",
    "ChatGPT Image Sep 30, 2026, 07_44_32 PM.png": "crollo",
    "ChatGPT Image Sep 30, 2026, 07_44_29 PM.png": "prontezza",
    "ChatGPT Image Sep 30, 2026, 07_44_21 PM.png": "fuel",
    "ChatGPT Image Sep 30, 2026, 07_44_17 PM.png": "sonno",
    "ChatGPT Image Sep 30, 2026, 07_44_12 PM.png": "scarico",
    "ChatGPT Image Sep 30, 2026, 07_44_07 PM.png": "fiamma",
    "ChatGPT Image Sep 30, 2026, 07_43_52 PM.png": "obiettivo",
    "ChatGPT Image Sep 30, 2026, 07_38_34 PM.png": "scarpe",
}


def process_image(client: Client, src_path: Path, asset_name: str) -> None:
    print(f"-> Processing '{asset_name}' from '{src_path.name}'...")
    # Call BRIA-RMBG-1.4 API
    result_path = client.predict(handle_file(str(src_path)), api_name="/predict")

    with Image.open(result_path) as img:
        img = img.convert("RGBA")

        # Trim transparent margins with a slight padding
        bbox = img.getbbox()
        if bbox:
            img = img.crop(bbox)

        # Pad with 12px transparent border so edges aren't flush
        pad = 12
        padded = Image.new("RGBA", (img.width + pad * 2, img.height + pad * 2), (0, 0, 0, 0))
        padded.paste(img, (pad, pad))
        img = padded

        # Save full-res PNG in assets-src
        SRC_DEST_DIR.mkdir(parents=True, exist_ok=True)
        raw_dest = SRC_DEST_DIR / f"{asset_name}.png"
        img.save(raw_dest, format="PNG")

        # Resize to max 640px for web performance while preserving sharpness
        max_dim = 640
        w, h = img.size
        if max(w, h) > max_dim:
            scale = max_dim / max(w, h)
            new_size = (int(w * scale), int(h * scale))
            img_web = img.resize(new_size, Image.Resampling.LANCZOS)
        else:
            img_web = img

        # Save WebP with alpha preservation in public/illustrazioni/
        PUBLIC_DEST_DIR.mkdir(parents=True, exist_ok=True)
        webp_dest = PUBLIC_DEST_DIR / f"{asset_name}.webp"
        img_web.save(webp_dest, format="WEBP", quality=90, method=6)
        print(f"   [OK] Saved {webp_dest.relative_to(PROJECT_ROOT)} ({img_web.size[0]}x{img_web.size[1]}px, {webp_dest.stat().st_size / 1024:.1f} KB)")


def main():
    if not DOWNLOADS_DIR.exists():
        print(f"Error: directory {DOWNLOADS_DIR} does not exist.")
        sys.exit(1)

    print(f"Connecting to Hugging Face BRIA-RMBG-1.4 Space...")
    client = Client("briaai/BRIA-RMBG-1.4")
    print(f"Connected successfully. Found {len(FILE_MAP)} images to process.\n")

    items = list(FILE_MAP.items())
    for index, (filename, asset_name) in enumerate(items, 1):
        src_path = DOWNLOADS_DIR / filename
        if not src_path.exists():
            print(f"[{index}/{len(items)}] WARNING: {filename} not found in {DOWNLOADS_DIR}, skipping.")
            continue

        print(f"[{index}/{len(items)}]", end=" ")
        try:
            process_image(client, src_path, asset_name)
        except Exception as e:
            print(f"   [ERROR] Failed to process {filename}: {e}")

    print("\nAll done! Images are ready in web/public/illustrazioni/.")


if __name__ == "__main__":
    main()
