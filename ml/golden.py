"""Preparar HU22 desde el split test existente o generar fixtures sintéticos explícitos."""

import argparse
import json
import shutil
from pathlib import Path

from ml.regression import CLASSES, sha256, validate_golden, write_json
from PIL import Image


def build(destination, source=None, root=None):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    rows = []
    if source:
        manifest = json.loads(Path(source).read_text(encoding="utf-8"))
        selected = []
        for label in (0, 1):
            group = sorted(
                (r for r in manifest["rows"] if r["split"] == "test" and r["label"] == label),
                key=lambda r: r["path"],
            )
            if len(group) < 25:
                raise ValueError("Se necesitan 25 imágenes test por clase.")
            selected.extend(group[:25])
    else:
        selected = [{"label": index % 2} for index in range(50)]
    for index, row in enumerate(selected):
        identifier = f"hu22-{index:03d}"
        name = f"{identifier}.png"
        target = destination / name
        if source:
            path = (Path(root).resolve() / row["path"]).resolve()
            if not path.is_relative_to(Path(root).resolve()) or sha256(path) != row["sha256"]:
                raise ValueError("Imagen fuente fuera de raíz o hash inválido.")
            # Mantener bytes originales y su extensión; no reetiquetar ni recodificar.
            name = f"{identifier}{path.suffix.lower()}"
            target = destination / name
            shutil.copyfile(path, target)
        else:
            Image.new("RGB", (32, 32), (index * 5, index * 3, index * 2)).save(target, compress_level=0)
        rows.append(
            {
                "id": identifier,
                "path": name,
                "label": row["label"],
                "sha256": sha256(target),
                "source": row.get("path", "synthetic:RGB-generated-not-a-casting-image"),
            }
        )
    write_json(
        destination / "manifest.json",
        {
            "schema_version": 1,
            "classes": CLASSES,
            "kind": "real" if source else "synthetic",
            "label_provenance": "existing-test-manifest" if source else "alternating-fixture-only-not-ground-truth",
            "source_manifest_sha256": sha256(source) if source else None,
            "rows": rows,
        },
    )
    validate_golden(destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-manifest")
    parser.add_argument("--root", default=".")
    args = parser.parse_args()
    build(args.output, args.source_manifest, args.root)
