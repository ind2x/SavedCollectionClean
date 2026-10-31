"""Build only distributable extension files and the static guide. No credentials or logs."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent.parent
EXTENSION = ROOT / "savedpoststree-extension"
OUTPUT = ROOT / "development/.hosting/dist"
SITE = ROOT / "development/site"


def main():
    manifest = json.loads((EXTENSION / "manifest.json").read_text())
    version = manifest["version"]
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name in ("index.html", "style.css", "site.js"):
        shutil.copyfile(SITE / name, OUTPUT / name)
    (OUTPUT / "assets").mkdir(exist_ok=True)
    shutil.copyfile(EXTENSION / "icons/128.png", OUTPUT / "assets/icon.png")
    downloads = OUTPUT / "downloads"
    downloads.mkdir(exist_ok=True)
    archive = downloads / ("savedpoststree-extension-" + version + ".zip")
    files = sorted(p for p in EXTENSION.rglob("*") if p.is_file())
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path in files:
            if any(part.startswith(".") or part == "__pycache__" for part in path.relative_to(EXTENSION).parts):
                continue
            if path.suffix not in {".json", ".js", ".css", ".html", ".png", ".svg", ".txt"}:
                raise ValueError("Unexpected distributable file: " + str(path))
            info = zipfile.ZipInfo("savedpoststree-extension/" + path.relative_to(EXTENSION).as_posix(), (2026, 11, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            bundle.writestr(info, path.read_bytes())
        license_path = ROOT / "LICENSE"
        if license_path.exists():
            info = zipfile.ZipInfo("LICENSE", (2026, 11, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            bundle.writestr(info, license_path.read_bytes())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (downloads / (archive.name + ".sha256")).write_text(digest + "  " + archive.name + "\n")
    print(json.dumps({"version": version, "archive": str(archive), "sha256": digest, "site": str(OUTPUT)}))


if __name__ == "__main__":
    main()
