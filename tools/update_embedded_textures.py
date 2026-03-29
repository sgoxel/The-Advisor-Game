import os
import base64
import mimetypes

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TEXTURE_DIR = os.path.join(BASE_DIR, "textures")
OUTPUT_FILE = os.path.join(BASE_DIR, "js", "embedded_textures.js")

SUPPORTED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}

def encode_image(path):
    mime, _ = mimetypes.guess_type(path)
    if not mime:
        mime = "image/png"
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode("ascii")
    return f"data:{mime};base64,{data}"

def collect_texture_files():
    if not os.path.isdir(TEXTURE_DIR):
        raise FileNotFoundError(f"Texture folder not found: {TEXTURE_DIR}")

    files = []
    for name in sorted(os.listdir(TEXTURE_DIR)):
        full = os.path.join(TEXTURE_DIR, name)
        ext = os.path.splitext(name)[1].lower()
        if os.path.isfile(full) and ext in SUPPORTED_EXT:
            files.append((name, full))
    return files

def write_js(files):
    lines = []
    lines.append("window.Game = window.Game || {};")
    lines.append("window.Game.EmbeddedTextures = {")
    for file_name, full_path in files:
        data_url = encode_image(full_path)
        escaped = data_url.replace("\\", "\\\\").replace('"', '\\"')
        # IMPORTANT: key must be the FILE NAME, because renderer.js does:
        # const fileName = String(url || '').split('/').pop();
        # return embedded[fileName]
        lines.append(f'  "{file_name}": "{escaped}",')
    lines.append("};")
    lines.append("")

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))

def main():
    print("Updating embedded_textures.js ...")
    files = collect_texture_files()
    if not files:
        raise RuntimeError(f"No supported texture files found in: {TEXTURE_DIR}")

    write_js(files)

    print("Done.")
    print(f"Textures folder : {TEXTURE_DIR}")
    print(f"Output file     : {OUTPUT_FILE}")
    print("Embedded files:")
    for name, _ in files:
        print(f" - {name}")

if __name__ == "__main__":
    main()
