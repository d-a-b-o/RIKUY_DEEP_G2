"""Recuperar objetos DVC desde archivos públicos de Drive con hashes fijados en Git."""

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen

from ml.regression import sha256, write_json


def object_path(remote, md5):
    if not isinstance(md5, str) or not re.fullmatch(r"[0-9a-f]{32}(?:\.dir)?", md5):
        raise ValueError("Identificador MD5 DVC inválido.")
    return Path(remote) / "files" / "md5" / md5[:2] / md5[2:]


def verify(path, spec):
    if sha256(path) != spec["sha256"]:
        raise ValueError("SHA256 del objeto DVC no coincide con la referencia.")
    if hashlib.md5(Path(path).read_bytes()).hexdigest() != spec["md5"].removesuffix(".dir"):
        raise ValueError("MD5 del objeto DVC no coincide con la referencia.")


def download_public(identifier, target):
    """Endpoint de contenido público; sin cookies ni credenciales y con timeout."""
    if not re.fullmatch(r"[A-Za-z0-9_-]+", identifier):
        raise ValueError("ID público de Drive inválido.")
    url = f"https://drive.usercontent.google.com/download?id={identifier}&export=download&confirm=t"
    for attempt in range(3):
        try:
            with urlopen(url, timeout=30) as stream, Path(target).open("wb") as output:
                shutil.copyfileobj(stream, output)
            return
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** (attempt + 1))


def hydrate(catalog_path, remote, downloader):
    """El catálogo sólo contiene IDs públicos y hashes, nunca cookies ni credenciales."""
    catalog_path = Path(catalog_path).resolve()
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    if catalog.get("schema_version") != 1 or not catalog.get("objects"):
        raise ValueError("Catálogo de recuperación inválido.")
    seen = set()
    for spec in catalog["objects"]:
        object_path(remote, spec["md5"])
        if spec["md5"] in seen:
            raise ValueError("Objeto DVC duplicado en catálogo.")
        seen.add(spec["md5"])
        if not re.fullmatch(r"[0-9a-f]{64}", spec.get("sha256", "")):
            raise ValueError("SHA256 ausente o inválido.")
        if ("metadata" in spec) == ("drive_id" in spec):
            raise ValueError("Cada objeto exige una única fuente.")

    if "bundle" in catalog:
        bundle = catalog["bundle"]
        if not re.fullmatch(r"[A-Za-z0-9_-]+", bundle.get("drive_id", "")):
            raise ValueError("ID del paquete de Drive inválido.")
        archive_path = Path(remote).resolve().parent / "hu22-reference.zip"
        archive_path.parent.mkdir(parents=True, exist_ok=True)
        if not archive_path.exists():
            temporary = archive_path.with_suffix(".partial")
            try:
                downloader(bundle["drive_id"], temporary)
                if sha256(temporary) != bundle["sha256"]:
                    raise ValueError("SHA256 del paquete de referencia inválido.")
                temporary.replace(archive_path)
            finally:
                temporary.unlink(missing_ok=True)
        if sha256(archive_path) != bundle["sha256"]:
            raise ValueError("SHA256 del paquete en cache inválido.")
        with zipfile.ZipFile(archive_path) as archive:
            expected = {object_path(remote, spec["md5"]).relative_to(remote).as_posix() for spec in catalog["objects"]}
            if set(archive.namelist()) != expected or len(archive.namelist()) != len(expected):
                raise ValueError("Contenido del paquete DVC incompleto o inesperado.")
            for spec in catalog["objects"]:
                target = object_path(remote, spec["md5"])
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists():
                    temporary = target.with_name(target.name + ".partial")
                    try:
                        with archive.open(target.relative_to(remote).as_posix()) as stream, temporary.open("wb") as out:
                            shutil.copyfileobj(stream, out)
                        verify(temporary, spec)
                        temporary.replace(target)
                    finally:
                        temporary.unlink(missing_ok=True)
                verify(target, spec)
        return

    def restore(spec):
        target = object_path(remote, spec["md5"])
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            verify(target, spec)
            return
        temporary = target.with_name(target.name + ".partial")
        try:
            if "metadata" in spec:
                source = (catalog_path.parent / spec["metadata"]).resolve()
                if not source.is_relative_to(catalog_path.parent):
                    raise ValueError("Metadatos fuera del directorio del catálogo.")
                shutil.copyfile(source, temporary)
            else:
                if not re.fullmatch(r"[A-Za-z0-9_-]+", spec["drive_id"]):
                    raise ValueError("ID público de Drive inválido.")
                downloader(spec["drive_id"], temporary)
            verify(temporary, spec)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(restore, catalog["objects"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", default="ml/regression-sources.json")
    parser.add_argument("--remote", default="reports/hu22-dvc-remote")
    args = parser.parse_args()
    try:
        hydrate(args.catalog, args.remote, download_public)
        remote = str(Path(args.remote).resolve())
        subprocess.run([sys.executable, "-m", "dvc", "remote", "add", "--local", "-f", "hu22-ci", remote], check=True)
        subprocess.run(
            [sys.executable, "-m", "dvc", "pull", "-r", "hu22-ci", "golden/real.dvc", "models/regression.dvc"],
            check=True,
        )
        return 0
    except Exception as exc:
        write_json(
            "reports/regression/regression.json",
            {"passed": False, "status": "retrieval_error", "error": str(exc)},
        )
        print(f"Recuperación DVC bloqueada: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
