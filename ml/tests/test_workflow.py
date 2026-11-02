"""Pruebas sin TensorFlow, red, DVC real ni datos del usuario."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
from ml.workflow import (
    Config,
    check_artifacts,
    choose_threshold,
    datasets,
    file_hash,
    load_manifest,
    preflight,
    prepare_data,
    read_json,
    select_model,
    train,
    version_with_dvc,
    write_json,
)
from PIL import Image


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "ml").mkdir()
        (self.root / "ml/preprocessing.py").touch()
        (self.root / ".dvc").mkdir()
        self.config = Config(self.root)
        for label, name in enumerate(("ok_front", "def_front")):
            directory = self.config.raw / name
            directory.mkdir(parents=True)
            for i in range(20):
                Image.new("RGB", (8, 8), (label * 120, i * 5, 20)).save(directory / f"{i:02}.png")

    def test_prepare_reuses_file_and_excludes_duplicates(self):
        source = self.config.raw / "ok_front/00.png"
        Image.open(source).save(self.config.raw / "ok_front/duplicate.bmp")
        first = prepare_data(self.config)
        path = self.config.prepared / "manifest.json"
        modified = path.stat().st_mtime_ns
        second = prepare_data(self.config)
        self.assertEqual(first, second)
        self.assertEqual(modified, path.stat().st_mtime_ns)
        self.assertEqual(first["duplicates_removed"], 1)
        self.assertEqual(len({r["pixel_hash"] for r in first["rows"]}), len(first["rows"]))
        self.assertEqual(len(first["rows"]), 40)

    def test_changed_content_stops_before_training(self):
        prepare_data(self.config)
        Image.new("RGB", (8, 8), (255, 255, 255)).save(self.config.raw / "ok_front/00.png")
        with self.assertRaises(ValueError):
            load_manifest(self.config)
        with self.assertRaises(RuntimeError):
            prepare_data(self.config)

    def test_conflicting_labels_rejected(self):
        Image.open(self.config.raw / "ok_front/00.png").save(self.config.raw / "def_front/conflict.png")
        with self.assertRaisesRegex(ValueError, "contradictorias"):
            prepare_data(self.config)

    def test_corrupt_images_rejected(self):
        (self.config.raw / "ok_front/broken.png").write_bytes(b"invalid image")
        with self.assertRaises(OSError):
            prepare_data(self.config)

    def test_incomplete_or_tampered_manifest_rejected(self):
        manifest = prepare_data(self.config)
        manifest["rows"].pop()
        write_json(self.config.prepared / "manifest.json", manifest)
        with self.assertRaises(ValueError):
            load_manifest(self.config)

    def test_disabled_plan_has_no_effects(self):
        before = sorted(self.root.rglob("*"))
        preflight(self.config, {"download": False, "cnn": False, "prepare": False})
        self.assertEqual(before, sorted(self.root.rglob("*")))

    def test_unknown_stage_rejected(self):
        with self.assertRaises(ValueError):
            preflight(self.config, {"typo": True})

    def test_bad_config_rejected(self):
        with self.assertRaises(ValueError):
            Config(self.root, batch_size=0)

    def test_artifact_integrity(self):
        model = self.root / "best.keras"
        model.write_bytes(b"model")
        record = {"artifacts": {"best.keras": file_hash(model)}}
        check_artifacts(self.root, record)
        model.write_bytes(b"changed")
        with self.assertRaises(ValueError):
            check_artifacts(self.root, record)

    @patch("ml.workflow.shutil.which", return_value="dvc")
    @patch("ml.workflow.command")
    def test_dvc_unchanged_skips_add_but_retries_pending_push(self, command, _which):
        (self.root / "data.dvc").touch()
        command.side_effect = ["drive /remote", "{}", '{"data": "new"}', ""]
        result = version_with_dvc(self.config, self.root / "data", push=True, remote="drive")
        calls = [call.args[1] for call in command.call_args_list]
        self.assertFalse(result["updated"])
        self.assertFalse(any(c[:2] == ["dvc", "add"] for c in calls))
        self.assertEqual(calls[-1], ["dvc", "push", "data.dvc", "--remote", "drive"])

    @patch("ml.workflow.shutil.which", return_value="dvc")
    @patch("ml.workflow.command")
    def test_bad_remote_checked_before_dvc_add(self, command, _which):
        command.return_value = "other /remote"
        with self.assertRaises(ValueError):
            version_with_dvc(self.config, self.root / "data", push=True, remote="drive")
        self.assertEqual(command.call_count, 1)

    @patch("ml.workflow.shutil.which", return_value="dvc")
    @patch("ml.workflow.command")
    def test_nested_output_rejected(self, command, _which):
        (self.root / "data.dvc").touch()
        with self.assertRaises(ValueError):
            version_with_dvc(self.config, self.config.raw)
        command.assert_not_called()

    @patch("ml.workflow.shutil.which", return_value="dvc")
    @patch("ml.workflow.command", return_value="")
    def test_first_dvc_add_happens_once(self, command, _which):
        version_with_dvc(self.config, self.root / "data")
        command.assert_called_once_with(self.config, ["dvc", "add", "data"])

    def test_selection_uses_validation_only(self):
        candidates = []
        for i, (recall, accuracy) in enumerate(((0.9, 0.99), (0.96, 0.98))):
            directory = self.root / f"run{i}"
            write_json(
                directory / "validation.json", {"recall": recall, "accuracy": accuracy, "average_precision": 0.98}
            )
            candidates.append(directory)
        self.assertEqual(select_model(self.config, candidates), candidates[1])

    def test_threshold_respects_recall(self):
        y = np.array([0, 0, 1, 1])
        p = np.array([0.1, 0.7, 0.6, 0.9])
        threshold = choose_threshold(y, p, 1.0)
        self.assertEqual(threshold, 0.6)
        self.assertEqual(int(((p >= threshold) & (y == 1)).sum()), 2)

    @patch("ml.preprocessing.make_tf_dataset")
    def test_augmentation_only_reaches_train(self, make_dataset):
        self.assertTrue(self.config.augmentation)
        manifest = prepare_data(self.config)
        datasets(self.config, manifest, augmentation=self.config.augmentation)
        train_call, validation_call, test_call = make_dataset.call_args_list
        self.assertTrue(train_call.kwargs["training"])
        self.assertTrue(train_call.kwargs["augment"])
        for call in (validation_call, test_call):
            self.assertFalse(call.kwargs["training"])
            self.assertFalse(call.kwargs["augment"])
        train_paths = set(train_call.args[0])
        self.assertTrue(train_paths.isdisjoint(validation_call.args[0]))
        self.assertTrue(train_paths.isdisjoint(test_call.args[0]))

    @patch("ml.preprocessing.make_tf_dataset")
    def test_optional_baseline_disables_augmentation_but_shuffles_train(self, make_dataset):
        datasets(self.config, prepare_data(self.config), augmentation=False)
        self.assertTrue(make_dataset.call_args_list[0].kwargs["training"])
        self.assertTrue(all(not call.kwargs["augment"] for call in make_dataset.call_args_list))

    def test_training_reexecution_does_not_fit_again(self):
        prepare_data(self.config)
        fake_tf = MagicMock()
        fake_model = MagicMock()
        fake_tf.keras.models.load_model.return_value.predict.return_value = np.array([[0.1], [0.9]])

        def fit(*args, **kwargs):
            directory = next((self.root / "models/experiments").iterdir())
            (directory / "best.keras").write_bytes(b"trained checkpoint")
            (directory / "history.csv").write_text("epoch,loss\n0,0.1\n")

        fake_model.fit.side_effect = fit
        with (
            patch.dict("sys.modules", {"tensorflow": fake_tf}),
            patch("ml.workflow.runtime_versions", return_value={"tensorflow": "test"}),
            patch("ml.workflow.datasets", return_value={"train": [], "validation": [], "test": []}),
            patch("ml.workflow.build_model", return_value=fake_model),
            patch("ml.workflow.choose_threshold", return_value=0.5),
            patch("ml.workflow.scores", return_value={"recall": 1.0}),
        ):
            first = train(self.config)
            self.assertTrue(read_json(first / "started.json")["params"]["augmentation"])
            self.assertEqual(first, train(self.config))
            fake_model.fit.assert_called_once()
            (first / "best.keras").write_bytes(b"corrupted checkpoint")
            with self.assertRaises(ValueError):
                train(self.config)
            fake_model.fit.assert_called_once()

    def test_notebook_is_clean_and_compiles(self):
        notebook = read_json(Path(__file__).resolve().parents[2] / "RIKUY_DEEP_G2.ipynb")
        for i, cell in enumerate(notebook["cells"]):
            if cell["cell_type"] == "code":
                source = "".join(cell["source"])
                if not source.lstrip().startswith(("!", "%")):
                    compile(source, f"cell-{i}", "exec")
        json.dumps(notebook)
