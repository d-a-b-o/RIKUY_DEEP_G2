import hashlib
import io
import json
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
from ml.regression import write_json
from ml.regression_data import download_public, hydrate, object_path


def spec(body, **source):
    return {
        "md5": hashlib.md5(body).hexdigest(),
        "sha256": hashlib.sha256(body).hexdigest(),
        **source,
    }


def test_recover_and_reuse_verified_objects(tmp_path):
    metadata = b'[{"md5":"a","relpath":"fixture"}]'
    downloaded = b"downloaded fixture, not an image"
    (tmp_path / "directory.json").write_bytes(metadata)
    directory = spec(metadata, metadata="directory.json")
    directory["md5"] += ".dir"
    remote_file = spec(downloaded, drive_id="public-id")
    catalog = tmp_path / "catalog.json"
    write_json(catalog, {"schema_version": 1, "objects": [directory, remote_file]})
    calls = []

    def download(identifier, target):
        calls.append(identifier)
        target.write_bytes(downloaded)

    remote = tmp_path / "remote"
    hydrate(catalog, remote, download)
    hydrate(catalog, remote, download)
    assert calls == ["public-id"]
    assert object_path(remote, directory["md5"]).read_bytes() == metadata
    assert object_path(remote, remote_file["md5"]).read_bytes() == downloaded
    # A corrupt existing cache must fail rather than be trusted/reported as recovered.
    object_path(remote, remote_file["md5"]).write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="SHA256"):
        hydrate(catalog, remote, download)


@pytest.mark.parametrize("fault", ["md5", "sha256", "duplicate", "path", "source", "drive_id"])
def test_invalid_recovery_catalog(tmp_path, fault):
    entry = spec(b"fixture", drive_id="public-id")
    objects = [entry]
    if fault == "md5":
        entry["md5"] = "../../outside"
    elif fault == "sha256":
        entry["sha256"] = "invalid"
    elif fault == "duplicate":
        objects.append(entry.copy())
    elif fault == "path":
        del entry["drive_id"]
        entry["metadata"] = "../outside"
    elif fault == "source":
        entry["metadata"] = "also-a-source"
    else:
        entry["drive_id"] = "https://untrusted.example/"
    catalog = tmp_path / "catalog.json"
    write_json(catalog, {"schema_version": 1, "objects": objects})
    with pytest.raises(ValueError):
        hydrate(catalog, tmp_path / "remote", lambda identifier, target: pytest.fail("Unexpected download"))


def test_reject_corrupt_download_and_remove_partial(tmp_path):
    entry = spec(b"expected", drive_id="public-id")
    catalog = tmp_path / "catalog.json"
    write_json(catalog, {"schema_version": 1, "objects": [entry]})
    remote = tmp_path / "remote"
    with pytest.raises(ValueError, match="SHA256"):
        hydrate(catalog, remote, lambda identifier, target: target.write_bytes(b"corrupt"))
    assert not object_path(remote, entry["md5"]).exists()
    assert not list(remote.rglob("*.partial"))


@pytest.mark.parametrize("fault", [None, "archive_hash", "object_hash", "extra_path", "missing"])
def test_bundle_recovery_and_integrity(tmp_path, fault):
    body = b"fixture DVC object"
    entry = spec(body, drive_id="original-source")
    archive_bytes = io.BytesIO()
    relative = object_path(Path("."), entry["md5"]).as_posix()
    with zipfile.ZipFile(archive_bytes, "w") as archive:
        if fault != "missing":
            archive.writestr(relative, b"corrupt object" if fault == "object_hash" else body)
        if fault == "extra_path":
            archive.writestr("../../outside", b"unexpected")
    payload = archive_bytes.getvalue()
    bundle_sha = hashlib.sha256(payload).hexdigest() if fault != "archive_hash" else "0" * 64
    catalog = tmp_path / "catalog.json"
    write_json(
        catalog,
        {
            "schema_version": 1,
            "objects": [entry],
            "bundle": {"drive_id": "reference-bundle", "sha256": bundle_sha},
        },
    )
    calls = []

    def download(identifier, target):
        calls.append(identifier)
        target.write_bytes(payload)

    remote = tmp_path / "remote"
    if fault:
        with pytest.raises(ValueError):
            hydrate(catalog, remote, download)
        assert not object_path(remote, entry["md5"]).exists()
        assert not (tmp_path / "outside").exists()
        assert not list(tmp_path.rglob("*.partial"))
    else:
        hydrate(catalog, remote, download)
        hydrate(catalog, remote, download)
        assert calls == ["reference-bundle"]
        assert object_path(remote, entry["md5"]).read_bytes() == body


def test_new_reference_stays_pending_and_never_downloads_old_objects(tmp_path):
    directory = Path(__file__).resolve().parents[1]
    catalog = json.loads((directory / "regression-sources.json").read_text())
    config = json.loads((directory / "regression-config.json").read_text())
    assert catalog["architecture"] == config["architecture"] == "resnet50v2"
    if catalog["status"].startswith("pending"):
        if catalog["status"] == "pending_resnet50v2_training":
            assert catalog["objects"] == []

        def forbidden_download(*args):
            pytest.fail("No descargar artefactos retirados")

        with pytest.raises(ValueError, match="pendiente"):
            hydrate(directory / "regression-sources.json", tmp_path / "remote", forbidden_download)
    else:
        assert catalog["status"] == config["status"] == "ready"
        rows = json.loads((directory / "regression-metadata/golden-manifest.json").read_text())["rows"]
        assert len(rows) == len({r["id"] for r in rows}) == 50
        assert sum(r["label"] == 0 for r in rows) == sum(r["label"] == 1 for r in rows) == 25
        hashes = {entry["sha256"] for entry in catalog["objects"]}
        assert {r["sha256"] for r in rows} <= hashes
        for role in ("baseline", "candidate"):
            assert config[role]["sha256"] in hashes
            assert config[role]["contract"] == config["contract"]


@pytest.mark.parametrize("always_fail", [False, True])
def test_public_download_retries_are_bounded(tmp_path, monkeypatch, always_fail):
    calls, waits = [], []

    def open_stream(url, timeout):
        calls.append((url, timeout))
        if always_fail or len(calls) == 1:
            raise OSError("transient network failure")
        return io.BytesIO(b"fixture bytes")

    monkeypatch.setattr("ml.regression_data.urlopen", open_stream)
    monkeypatch.setattr("ml.regression_data.time.sleep", waits.append)
    target = tmp_path / "download"
    if always_fail:
        with pytest.raises(OSError):
            download_public("public-id", target)
        assert len(calls) == 3
        assert waits == [2, 4]
    else:
        download_public("public-id", target)
        assert target.read_bytes() == b"fixture bytes"
        assert len(calls) == 2
        assert waits == [2]
    assert all(timeout == 30 for _, timeout in calls)


def test_public_large_file_confirmation_returns_binary_not_html(tmp_path, monkeypatch):
    confirmation = b"""<!doctype html><html><form id="download-form"
        action="https://drive.usercontent.google.com/download" method="get">
        <input type="hidden" name="id" value="public-id">
        <input type="hidden" name="export" value="download">
        <input type="hidden" name="confirm" value="t">
        <input type="hidden" name="uuid" value="confirmation-token">
        </form></html>"""
    calls = []

    def open_stream(url, timeout):
        calls.append(url)
        return io.BytesIO(confirmation if len(calls) == 1 else b"PK-binary-zip-fixture")

    monkeypatch.setattr("ml.regression_data.urlopen", open_stream)
    target = tmp_path / "bundle"
    download_public("public-id", target)
    assert target.read_bytes() == b"PK-binary-zip-fixture"
    assert len(calls) == 2
    assert parse_qs(urlsplit(calls[1]).query)["uuid"] == ["confirmation-token"]


@pytest.mark.parametrize(
    "html",
    [
        b"<html>Access denied</html>",
        b'<html><form id="download-form" action="https://untrusted.example/download">'
        b'<input name="id" value="public-id"></form></html>',
        b'<html><form id="download-form" action="https://drive.usercontent.google.com/download">'
        b'<input name="id" value="other-id"><input name="confirm" value="t"></form></html>',
    ],
)
def test_public_html_errors_are_not_saved_as_artifacts(tmp_path, monkeypatch, html):
    monkeypatch.setattr("ml.regression_data.urlopen", lambda *args, **kwargs: io.BytesIO(html))
    target = tmp_path / "bundle"
    with pytest.raises(ValueError):
        download_public("public-id", target)
    assert not target.exists()


def test_public_confirmation_loop_is_bounded(tmp_path, monkeypatch):
    calls = []
    html = (
        b'<html><form id="download-form" action="https://drive.usercontent.google.com/download">'
        b'<input name="id" value="public-id"><input name="confirm" value="t"></form></html>'
    )

    def open_stream(*args, **kwargs):
        calls.append(True)
        return io.BytesIO(html)

    monkeypatch.setattr("ml.regression_data.urlopen", open_stream)
    with pytest.raises(ValueError, match="repiti"):
        download_public("public-id", tmp_path / "bundle")
    assert len(calls) == 3


def test_public_download_rejects_google_login_redirect(tmp_path, monkeypatch):
    class LoginResponse(io.BytesIO):
        def geturl(self):
            return "https://accounts.google.com/v3/signin/identifier"

    monkeypatch.setattr("ml.regression_data.urlopen", lambda *args, **kwargs: LoginResponse(b"<html>Sign in</html>"))
    target = tmp_path / "bundle"
    with pytest.raises(ValueError, match="exige iniciar sesi"):
        download_public("public-id", target)
    assert not target.exists()
