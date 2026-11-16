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
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit
from urllib.request import urlopen

from ml.regression import require_ready_reference, sha256, write_json


def object_path(remote, md5):
    if not isinstance(md5, str) or not re.fullmatch(r"[0-9a-f]{32}(?:\.dir)?", md5):
        raise ValueError("Identificador MD5 DVC inválido.")
    return Path(remote) / "files" / "md5" / md5[:2] / md5[2:]


def verify(path, spec):
    if sha256(path) != spec["sha256"]:
        raise ValueError("SHA256 del objeto DVC no coincide con la referencia.")
    if hashlib.md5(Path(path).read_bytes()).hexdigest() != spec["md5"].removesuffix(".dir"):
        raise ValueError("MD5 del objeto DVC no coincide con la referencia.")


class DriveConfirmation(HTMLParser):
    """Leer únicamente el formulario de confirmación de descarga pública de Drive."""

    def __init__(self):
        super().__init__()
        self.action = None
        self.fields = {}
        self.active = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "form":
            self.active = attrs.get("id") == "download-form" and attrs.get("method", "get").lower() == "get"
            if self.active:
                self.action = attrs.get("action", "")
        elif tag == "input" and self.active and attrs.get("name") in {"id", "export", "confirm", "uuid"}:
            self.fields[attrs["name"]] = attrs.get("value", "")

    def handle_endtag(self, tag):
        if tag == "form":
            self.active = False

    def download_url(self, identifier):
        action = urlsplit(self.action or "")
        if action.scheme != "https" or action.netloc != "drive.usercontent.google.com" or action.path != "/download":
            raise ValueError(
                "Drive devolvió HTML sin una confirmación válida. Verifica acceso público y cuota del ZIP."
            )
        fields = {**dict(parse_qsl(action.query)), **self.fields}
        if fields.get("id") != identifier or not fields.get("confirm"):
            raise ValueError("La confirmación de Drive no corresponde al archivo solicitado.")
        return f"https://drive.usercontent.google.com/download?{urlencode(fields)}"


def download_public(identifier, target):
    """Descarga pública con confirmación de archivos grandes; nunca guardar HTML como ZIP."""
    if not re.fullmatch(r"[A-Za-z0-9_-]+", identifier):
        raise ValueError("ID público de Drive inválido.")
    url = f"https://drive.usercontent.google.com/download?id={identifier}&export=download&confirm=t"
    for attempt in range(3):
        try:
            current = url
            for _confirmation in range(3):
                with urlopen(current, timeout=30) as stream:
                    response_url = stream.geturl() if hasattr(stream, "geturl") else current
                    if urlsplit(response_url).hostname == "accounts.google.com":
                        raise ValueError(
                            "Drive exige iniciar sesión: el ID configurado no permite descargar el ZIP anónimamente. "
                            "Comparte el archivo como 'Cualquier persona con el enlace: Lector', habilita su descarga "
                            "y comprueba el enlace sin iniciar sesión."
                        )
                    prefix = stream.read(4096)
                    content_type = getattr(stream, "headers", {}).get("Content-Type", "").lower()
                    html = "text/html" in content_type or prefix.lstrip().lower().startswith(
                        (b"<!doctype html", b"<html")
                    )
                    if html:
                        parser = DriveConfirmation()
                        parser.feed((prefix + stream.read(1024 * 1024)).decode("utf-8", errors="replace"))
                        current = parser.download_url(identifier)
                        continue
                    with Path(target).open("wb") as output:
                        output.write(prefix)
                        shutil.copyfileobj(stream, output)
                    return
            raise ValueError("Drive repitió la confirmación de descarga; no se obtuvo el archivo público.")
        except OSError:
            if attempt == 2:
                raise
            time.sleep(2 ** (attempt + 1))


def hydrate(catalog_path, remote, downloader):
    """El catálogo sólo contiene IDs públicos y hashes, nunca cookies ni credenciales."""
    catalog_path = Path(catalog_path).resolve()
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    require_ready_reference(catalog)
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
        if sum(key in spec for key in ("metadata", "drive_id", "bundle_member")) != 1:
            raise ValueError("Cada objeto exige una única fuente.")
        if "bundle_member" in spec and (spec["bundle_member"] is not True or "bundle" not in catalog):
            raise ValueError("Un miembro de bundle requiere un paquete configurado.")

    if "bundle" in catalog:
        bundle = catalog["bundle"]
        if not re.fullmatch(r"[A-Za-z0-9_-]+", bundle.get("drive_id", "")):
            raise ValueError("ID del paquete de Drive inválido.")
        if not re.fullmatch(r"[0-9a-f]{64}", bundle.get("sha256", "")):
            raise ValueError("SHA256 del paquete de referencia inválido.")
        archive_path = Path(remote).resolve().parent / f"hu22-reference-{bundle['sha256']}.zip"
        archive_path.parent.mkdir(parents=True, exist_ok=True)
        if not archive_path.exists():
            temporary = archive_path.with_suffix(".partial")
            try:
                downloader(bundle["drive_id"], temporary)
                received = sha256(temporary)
                if received != bundle["sha256"]:
                    raise ValueError(
                        f"SHA256 del paquete de referencia inválido: esperado={bundle['sha256']}, "
                        f"recibido={received}, bytes={temporary.stat().st_size}, "
                        f"zip_valido={zipfile.is_zipfile(temporary)}. "
                        "El archivo público debe ser exactamente el ZIP validado en Colab."
                    )
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
