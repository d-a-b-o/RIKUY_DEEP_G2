"""Contrato del exportador de referencias CI; pesos y predicciones son fixtures, no evidencia ML."""

import ast
import hashlib
import json
import os
import shutil
import types
import zipfile
from pathlib import Path

import pytest
from ml.quality_gate import evaluate_quality_gate, require_quality_gate
from ml.regression import CLASSES, require_resnet_run, validate_golden
from ml.regression_data import hydrate, object_path
from ml.workflow import file_hash, read_json, write_json
from PIL import Image


@pytest.fixture
def ci_reference(tmp_path, monkeypatch):
    run = tmp_path / "models/experiments/resnet-fixture"
    run.mkdir(parents=True)
    (run / "best.keras").write_bytes(b"unit test weights only")
    write_json(run / "started.json", {"params": {"kind": "resnet50v2"}})
    write_json(run / "completed.json", {"identity": "test-identity"})
    prepared = tmp_path / "data/prepared"
    write_json(prepared / "manifest.json", {"unit_fixture": True})
    rows = []
    for i in range(195):
        path = tmp_path / "data" / f"{i}.png"
        Image.new("RGB", (2, 2), (i, 0, 20)).save(path)
        rows.append({"path": f"data/{i}.png", "id": str(i), "label": int(i >= 78), "sha256": file_hash(path)})
    predictions = [
        {"id": r["id"], "python": 0.9 if r["label"] else 0.1, "tfjs": 0.9 if r["label"] else 0.1} for r in rows
    ]
    report = evaluate_quality_gate(rows, predictions, 0.5)
    report.update(model_sha256="model", golden_sha256="golden")
    context = {
        "run": run,
        "rows": rows,
        "golden": rows,
        "model_sha256": "model",
        "golden_sha256": "golden",
        "threshold": 0.5,
    }
    cache = tmp_path / "cache"

    def blob(data, is_directory=False):
        checksum = hashlib.md5(data).hexdigest() + (".dir" if is_directory else "")
        path = object_path(cache, checksum)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return checksum

    def version(_config, target, **kwargs):
        target = Path(target)
        if target.is_dir():
            entries = [
                {"relpath": f.relative_to(target).as_posix(), "md5": blob(f.read_bytes())}
                for f in sorted(target.rglob("*"))
                if f.is_file()
            ]
            checksum = blob(json.dumps(entries).encode(), True)
        else:
            checksum = blob(target.read_bytes())
        write_json(Path(str(target) + ".dvc"), {"outs": [{"md5": checksum}]})
        return {"pointer": str(target) + ".dvc"}

    namespace = dict(
        Path=Path,
        os=os,
        json=json,
        re=__import__("re"),
        shutil=shutil,
        zipfile=zipfile,
        yaml=types.SimpleNamespace(safe_load=json.loads),
        file_hash=file_hash,
        read_json=read_json,
        write_json=write_json,
        require_quality_gate=require_quality_gate,
        CLASSES=CLASSES,
        version_with_dvc=version,
        PUSH_DVC=False,
        DVC_REMOTE="test",
        command=lambda *args: str(cache),
    )
    notebook = json.loads((Path(__file__).resolve().parents[2] / "RIKUY_DEEP_G2.ipynb").read_text(encoding="utf-8"))
    source = next(
        "".join(c["source"]) for c in notebook["cells"] if "def build_resnet_ci_reference(" in "".join(c["source"])
    )
    node = next(
        n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == "build_resnet_ci_reference"
    )
    exec(compile(ast.Module(body=[node], type_ignores=[]), "<notebook>", "exec"), namespace)
    monkeypatch.setenv("RIKUY_REGRESSION_BUNDLE_ID", "public-fixture-id")
    return (
        namespace["build_resnet_ci_reference"],
        types.SimpleNamespace(root=tmp_path, prepared=prepared),
        context,
        report,
    )


def test_new_reference_bundle_is_consumable_by_ci(ci_reference, tmp_path):
    build, config, context, report = ci_reference
    catalog = build(config, context, report)
    assert catalog["status"] == "ready" and catalog["architecture"] == "resnet50v2"
    archive_hash = file_hash(tmp_path / "ci-reference-resnet.zip")
    build(config, context, report)
    assert file_hash(tmp_path / "ci-reference-resnet.zip") == archive_hash
    reference = read_json(tmp_path / "ml/regression-config.json")
    assert reference["baseline"]["sha256"] == reference["candidate"]["sha256"]
    golden = validate_golden(tmp_path / "golden/real")
    assert sum(r["label"] == 0 for r in golden["rows"]) == 25
    hydrate(
        tmp_path / "ml/regression-sources.json",
        tmp_path / "hydrated",
        lambda identifier, target: shutil.copyfile(tmp_path / "ci-reference-resnet.zip", target),
    )
    for spec in catalog["objects"]:
        assert file_hash(object_path(tmp_path / "hydrated", spec["md5"])) == spec["sha256"]


def test_failed_gate_does_not_generate_reference(ci_reference):
    build, config, context, report = ci_reference
    report["passed"] = False
    with pytest.raises(RuntimeError):
        build(config, context, report)
    assert not (config.root / "golden/real").exists()


def test_unconfigured_bundle_is_pending_not_a_successful_remote_reference(ci_reference, monkeypatch):
    build, config, context, report = ci_reference
    monkeypatch.delenv("RIKUY_REGRESSION_BUNDLE_ID")
    catalog = build(config, context, report)
    assert catalog["status"] == "pending_resnet_bundle_upload"
    with pytest.raises(ValueError, match="pendiente"):
        hydrate(
            config.root / "ml/regression-sources.json", config.root / "remote", lambda *args: pytest.fail("network")
        )


def test_testing_rejects_a_run_from_another_architecture():
    with pytest.raises(ValueError, match="ResNet50V2"):
        require_resnet_run({"params": {"kind": "cnn"}})


def bind_existing_bundle():
    notebook = json.loads((Path(__file__).resolve().parents[2] / "RIKUY_DEEP_G2.ipynb").read_text(encoding="utf-8"))
    source = next(
        "".join(c["source"]) for c in notebook["cells"] if "def bind_ci_reference_bundle(" in "".join(c["source"])
    )
    node = next(
        n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == "bind_ci_reference_bundle"
    )
    namespace = dict(
        Path=Path,
        json=json,
        os=os,
        re=__import__("re"),
        hashlib=hashlib,
        zipfile=zipfile,
        read_json=read_json,
        write_json=write_json,
        file_hash=file_hash,
    )
    exec(compile(ast.Module(body=[node], type_ignores=[]), "<notebook>", "exec"), namespace)
    return namespace["bind_ci_reference_bundle"]


def test_bind_existing_bundle_after_kernel_restart_preserves_archive(ci_reference):
    build, config, context, report = ci_reference
    build(config, context, report)
    before = file_hash(config.root / "ci-reference-resnet.zip")
    catalog = bind_existing_bundle()(config.root, "new-public-id")
    assert catalog["status"] == "ready"
    assert catalog["bundle"] == {"drive_id": "new-public-id", "sha256": before}
    assert file_hash(config.root / "ci-reference-resnet.zip") == before


def test_bind_existing_bundle_rejects_link_query_before_mutation(ci_reference):
    build, config, context, report = ci_reference
    build(config, context, report)
    before = file_hash(config.root / "ml/regression-sources.json")
    with pytest.raises(ValueError, match="sin \\?hl"):
        bind_existing_bundle()(config.root, "file-id?hl")
    assert file_hash(config.root / "ml/regression-sources.json") == before


def test_bind_existing_bundle_rejects_modified_zip(ci_reference):
    build, config, context, report = ci_reference
    build(config, context, report)
    archive = config.root / "ci-reference-resnet.zip"
    with zipfile.ZipFile(archive) as zipped:
        members = {name: zipped.read(name) for name in zipped.namelist()}
    members[next(iter(members))] = b"modified"
    with zipfile.ZipFile(archive, "w") as zipped:
        for name, data in members.items():
            zipped.writestr(name, data)
    before = file_hash(config.root / "ml/regression-sources.json")
    with pytest.raises(ValueError, match="Contenido del ZIP modificado"):
        bind_existing_bundle()(config.root, "valid-public-id")
    assert file_hash(config.root / "ml/regression-sources.json") == before
