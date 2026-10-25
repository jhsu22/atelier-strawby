#!/usr/bin/env python3
"""Package source only, with per-file SHA-256 integrity and no live local state."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
files = []
for directory in ["src", "public", "scripts", "tests", "docs", "drizzle"]:
    files.extend(p for p in (root / directory).rglob("*") if p.is_file() and not p.is_symlink() and "__pycache__" not in p.parts)
for name in ["README.md", "project_specification", "initial_collection.csv", "package.json", "package-lock.json", "astro.config.mjs", "drizzle.config.ts", "tsconfig.json", "eslint.config.mjs", "playwright.config.ts", "wrangler.toml", "wrangler.hosted.json.example", ".dev.vars.example", ".npmrc", ".gitignore", ".gitattributes"]:
    files.append(root / name)
manifest = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}
output = root / "releases" / "atelier-strawby-stage5.zip"
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in manifest:
        archive.write(root / name, "atelier-strawby/" + name)
    archive.writestr("atelier-strawby/SOURCE_MANIFEST.json", json.dumps(manifest, indent=2) + "\n")
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    for name, digest in manifest.items():
        assert hashlib.sha256(archive.read("atelier-strawby/" + name)).hexdigest() == digest
    assert not any(name in archive.namelist() for name in ["atelier-strawby/.dev.vars", "atelier-strawby/wrangler.hosted.json"])
checksum = hashlib.sha256(output.read_bytes()).hexdigest()
output.with_suffix(".zip.sha256").write_text(f"{checksum}  {output.name}\n")
print(f"Verified {len(manifest)} source files: {output} ({output.stat().st_size:,} bytes)")
