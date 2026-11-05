import ast
import copy
import hashlib
import io
import json
from pathlib import Path
from unittest.mock import Mock

import pytest
from ml.publication import R2ModelStore, publication_digest, publication_json, publish_tfjs_version
from ml.quality_gate import evaluate_quality_gate, require_quality_gate


class StorageError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class FakeS3:
    def __init__(self):
        self.objects = {}
        self.etags = {}
        self.writes = []
        self.fail_key = None
        self.concurrent_manifest_change = False

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise StorageError("NoSuchKey")
        return {"Body": io.BytesIO(self.objects[Key]), "ETag": self.etags.get(Key, '"existing"')}

    def put_object(self, **request):
        key = request["Key"]
        if key == self.fail_key:
            raise OSError("simulated upload failure")
        if key == "manifest.json" and self.concurrent_manifest_change:
            raise StorageError("PreconditionFailed")
        if request.get("IfNoneMatch") == "*" and key in self.objects:
            raise StorageError("PreconditionFailed")
        if "IfMatch" in request and request["IfMatch"] != self.etags.get(key):
            raise StorageError("PreconditionFailed")
        self.objects[key] = request["Body"]
        self.etags[key] = f'"etag-{len(self.writes)}"'
        self.writes.append(request)


@pytest.fixture
def release(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    (run / "best.keras").write_bytes(b"keras checkpoint")
    export = tmp_path / "export"
    web = export / "web"
    web.mkdir(parents=True)
    (web / "model.json").write_bytes(
        publication_json(
            {
                "format": "graph-model",
                "modelTopology": {},
                "weightsManifest": [{"paths": ["weights.bin"], "weights": []}],
            }
        )
    )
    (web / "weights.bin").write_bytes(b"weights")
    (web / "preprocessing.json").write_bytes(
        publication_json(
            {
                "labels": {"ok_front": 0, "def_front": 1},
                "positive_class": "def_front",
                "threshold": 0.5,
            }
        )
    )
    rows = [{"id": f"sample-{i}", "label": int(i >= 78)} for i in range(195)]
    predictions = [
        {"id": row["id"], "python": 0.9 if row["label"] else 0.1, "tfjs": 0.9 if row["label"] else 0.1} for row in rows
    ]
    report = evaluate_quality_gate(rows, predictions, 0.5)
    model_sha = publication_digest(
        {
            "keras": hashlib.sha256((run / "best.keras").read_bytes()).hexdigest(),
            "web": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in web.iterdir()},
        }
    )
    report.update(model_sha256=model_sha, golden_sha256="golden-hash")
    client = FakeS3()
    factory = Mock(return_value=R2ModelStore(client, "models"))

    def guard():
        require_quality_gate(report, model_sha, "golden-hash", rows)
        return report

    return {"run": run, "export": export, "report": report, "client": client, "factory": factory, "guard": guard}


def publish(release, **kwargs):
    return publish_tfjs_version(
        release["export"], release["run"], "1.0.0", kwargs.pop("guard", release["guard"]), release["factory"], **kwargs
    )


@pytest.mark.parametrize("reason", ["failed", "incomplete", "bad_metrics", "bad_parity", "model_changed"])
def test_failed_gate_performs_zero_storage_operations(release, reason):
    report = release["report"]
    if reason == "failed":
        report["passed"] = False
    elif reason == "incomplete":
        report["predictions"].pop()
    elif reason == "bad_metrics":
        for prediction in report["predictions"]:
            prediction.update(python=0.1, tfjs=0.1)
    elif reason == "bad_parity":
        for prediction in report["predictions"][:3]:
            prediction.update(python=0.499999, tfjs=0.500001)
    else:
        report["model_sha256"] = "other-model"
    with pytest.raises(RuntimeError):
        publish(release, dry_run=False)
    release["factory"].assert_not_called()
    assert release["client"].writes == []


def test_publication_does_not_trust_a_gate_callback_returning_a_failed_report(release):
    report = copy.deepcopy(release["report"])
    report["passed"] = False
    with pytest.raises(RuntimeError):
        publish(release, guard=lambda: report, dry_run=False)
    release["factory"].assert_not_called()


def test_changed_local_weights_block_before_any_upload(release):
    (release["export"] / "web" / "weights.bin").write_bytes(b"modified")
    with pytest.raises(RuntimeError, match="bytes"):
        publish(release, dry_run=False)
    release["factory"].assert_not_called()


def test_dry_run_never_opens_remote_store(release):
    result = publish(release)
    assert result["status"] == "dry_run"
    assert result["published"] is False
    release["factory"].assert_not_called()
    assert "v1.0.0/model.json" in result["plan"]["files"]


def test_success_uploads_assets_then_activates_manifest_after_second_gate(release):
    gate = Mock(side_effect=release["guard"])
    result = publish(release, guard=gate, dry_run=False)
    assert gate.call_count == 2
    assert result["published"]
    writes = release["client"].writes
    assert writes[-1]["Key"] == "manifest.json"
    assert writes[-1]["IfNoneMatch"] == "*"
    assert writes[-1]["CacheControl"] == "no-cache"
    for request in writes[:-1]:
        assert request["Key"].startswith("v1.0.0/")
        assert request["IfNoneMatch"] == "*"
        assert "immutable" in request["CacheControl"]
    manifest = json.loads(release["client"].objects["manifest.json"])
    assert manifest["activeVersion"] == "1.0.0"
    assert manifest["versions"][0]["threshold"] == 0.5
    assert manifest["versions"][0]["metrics"]["testAccuracy"] == 1.0


def test_gate_failure_after_upload_does_not_activate(release):
    gate = Mock(side_effect=[release["report"], RuntimeError("changed during upload")])
    with pytest.raises(RuntimeError):
        publish(release, guard=gate, dry_run=False)
    assert release["client"].writes
    assert "manifest.json" not in release["client"].objects


def test_upload_failure_does_not_activate_and_can_be_retried(release):
    release["client"].fail_key = "v1.0.0/weights.bin"
    with pytest.raises(OSError):
        publish(release, dry_run=False)
    assert "manifest.json" not in release["client"].objects
    release["client"].fail_key = None
    assert publish(release, dry_run=False)["published"]


def test_activation_uses_etag_and_preserves_previous_catalog(release):
    first = publish(release, dry_run=False)
    prior_etag = release["client"].etags["manifest.json"]
    result = publish_tfjs_version(
        release["export"], release["run"], "1.1.0", release["guard"], release["factory"], dry_run=False
    )
    assert first["published"] and result["published"]
    assert release["client"].writes[-1]["IfMatch"] == prior_etag
    catalog = json.loads(release["client"].objects["manifest.json"])
    assert [item["version"] for item in catalog["versions"]] == ["1.0.0", "1.1.0"]
    assert catalog["activeVersion"] == "1.1.0"


def test_conflict_does_not_replace_current_active_manifest(release):
    publish(release, dry_run=False)
    before = release["client"].objects["manifest.json"]
    release["client"].concurrent_manifest_change = True
    with pytest.raises(StorageError):
        publish_tfjs_version(
            release["export"], release["run"], "1.1.0", release["guard"], release["factory"], dry_run=False
        )
    assert release["client"].objects["manifest.json"] == before


def test_existing_version_cannot_be_overwritten(release):
    publish(release, dry_run=False)
    count = len(release["client"].writes)
    with pytest.raises(ValueError, match="ya está publicada"):
        publish(release, dry_run=False)
    assert len(release["client"].writes) == count


def test_immutable_object_conflict_cannot_be_silently_replaced(release):
    release["client"].objects["v1.0.0/weights.bin"] = b"another release"
    with pytest.raises(RuntimeError, match="inmutable"):
        publish(release, dry_run=False)
    assert release["client"].objects["v1.0.0/weights.bin"] == b"another release"
    assert "manifest.json" not in release["client"].objects


def test_invalid_remote_catalog_is_not_overwritten(release):
    release["client"].objects["manifest.json"] = publication_json({"schemaVersion": 999})
    release["client"].etags["manifest.json"] = '"old"'
    with pytest.raises(ValueError):
        publish(release, dry_run=False)
    assert release["client"].writes == []


def test_missing_credentials_or_permissions_are_not_treated_as_empty_catalog(release):
    store = R2ModelStore(Mock(), "models")
    store.client.get_object.side_effect = StorageError("AccessDenied")
    with pytest.raises(StorageError):
        store.read_manifest()


def test_published_metrics_are_recomputed_from_predictions(release):
    release["report"]["tensorflowjs"]["accuracy"] = -99
    release["report"]["max_absolute_difference"] = 999
    publish(release, dry_run=False)
    proof = json.loads(release["client"].objects["v1.0.0/quality_gate.json"])
    assert proof["tensorflowjs"]["accuracy"] == 1.0
    assert proof["max_absolute_difference"] == 0.0


def test_notebook_embeds_tested_publisher_and_defaults_to_dry_run():
    from ml import publication

    path = Path(__file__).resolve().parents[2] / "RIKUY_DEEP_G2.ipynb"
    notebook = json.loads(path.read_text(encoding="utf-8"))
    source = next(
        "".join(c["source"]) for c in notebook["cells"] if "def publish_tfjs_version(" in "".join(c["source"])
    )
    tree = ast.parse(source)
    expected = {
        node.name: ast.dump(node, include_attributes=False)
        for node in ast.parse(Path(publication.__file__).read_text(encoding="utf-8")).body
        if isinstance(node, (ast.FunctionDef, ast.ClassDef))
    }
    actual = {
        node.name: ast.dump(node, include_attributes=False)
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.ClassDef))
    }
    for name, definition in expected.items():
        assert actual[name] == definition
    assignment = next(
        node
        for node in tree.body
        if isinstance(node, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "PUBLISH_MODEL" for t in node.targets)
    )
    assert ast.literal_eval(assignment.value) is False
    call = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "publish_tfjs_version"
    )
    keywords = {keyword.arg: ast.unparse(keyword.value) for keyword in call.keywords}
    assert keywords["assert_ready"] == "assert_publication_ready"
    assert keywords["dry_run"] == "not PUBLISH_MODEL"
