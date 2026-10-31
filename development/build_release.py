"""Package the standalone extension with its license. Python standard library only."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
EXTENSION = ROOT / "insta-saved-collection-clean-extension"
OUTPUT = ROOT / "development/releases"


def main():
    manifest = json.loads((EXTENSION / "manifest.json").read_text())
    version = manifest["version"]
    OUTPUT.mkdir(parents=True, exist_ok=True)
    archive = OUTPUT / ("insta-saved-collection-clean-extension-" + version + ".zip")
    files = sorted(p for p in EXTENSION.rglob("*") if p.is_file())
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path in files:
            if any(part.startswith(".") or part == "__pycache__" for part in path.relative_to(EXTENSION).parts):
                continue
            if path.suffix not in {".json", ".js", ".css", ".html", ".png", ".svg", ".txt"}:
                raise ValueError("Unexpected distributable file: " + str(path))
            info = zipfile.ZipInfo("insta-saved-collection-clean-extension/" + path.relative_to(EXTENSION).as_posix(), (2026, 11, 1, 0, 0, 0))
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
    (OUTPUT / (archive.name + ".sha256")).write_text(digest + "  " + archive.name + "\n")
    print(json.dumps({"version": version, "archive": str(archive), "sha256": digest}))


if __name__ == "__main__":
    main()
