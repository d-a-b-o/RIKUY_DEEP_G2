"""Contrato del notebook entregable: orden, imports únicos y etapas idempotentes."""

import ast
import contextlib
import io
import json
import tempfile
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
from PIL import Image


class OrderedNotebookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from ml import workflow
        from ml.preprocessing import TARGET_SIZE

        path = Path(__file__).resolve().parents[2] / "RIKUY_DEEP_G2.ipynb"
        cls.notebook = json.loads(path.read_text(encoding="utf-8"))
        cls.ns = dict(vars(workflow))
        cls.ns.update(
            np=np,
            Image=Image,
            tf=MagicMock(),
            pd=MagicMock(),
            plt=MagicMock(),
            TARGET_SIZE=TARGET_SIZE,
            types=types,
            datetime=datetime,
            timezone=timezone,
        )
        with contextlib.redirect_stdout(io.StringIO()):
            for cell in cls.notebook["cells"]:
                if cell["cell_type"] != "code":
                    continue
                source = "".join(cell["source"])
                if source.lstrip().startswith(("!", "%")):
                    continue  # Nunca instalar, montar Drive ni entrenar durante CI.
                for node in ast.parse(source).body:
                    if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
                        if getattr(node, "name", "") == "QuietHandler":
                            continue
                        exec(compile(ast.Module(body=[node], type_ignores=[]), "<notebook>", "exec"), cls.ns)
                    elif isinstance(node, ast.Assign) and len(node.targets) == 1:
                        target = node.targets[0]
                        if isinstance(target, ast.Name) and target.id in {
                            "CLASSES",
                            "EXTENSIONS",
                            "TARGET_SIZE",
                            "TRAINING_FUNCTION_NAMES",
                            "NOTEBOOK_FUNCTION_NAMES",
                        }:
                            cls.ns[target.id] = ast.literal_eval(node.value)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.config = self.ns["Config"](self.root)
        for label, name in enumerate(("ok_front", "def_front")):
            directory = self.config.raw / name
            directory.mkdir(parents=True)
            for i in range(20):
                Image.new("RGB", (8, 8), (label * 120, i * 5, 20)).save(directory / f"{i:02}.png")

    def test_section_order_and_imports_are_not_inside_pipeline_functions(self):
        headings = [
            "".join(c["source"]).splitlines()[0].lower() for c in self.notebook["cells"] if c["cell_type"] == "markdown"
        ]
        expected = [
            "librer",
            "kaggle",
            "descargando",
            "versionando",
            "preprocesamiento",
            "entrenando",
            "transfer",
            "exportando",
        ]
        positions = [next(i for i, h in enumerate(headings) if word in h) for word in expected]
        self.assertEqual(positions, sorted(positions))
        for cell in self.notebook["cells"]:
            if cell["cell_type"] != "code":
                continue
            source = "".join(cell["source"])
            if source.lstrip().startswith(("!", "%")):
                continue
            for node in ast.parse(source).body:
                if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
                    imports = [n for n in ast.walk(node) if isinstance(n, (ast.Import, ast.ImportFrom))]
                    self.assertEqual(imports, [], node.name)
            self.assertNotIn("from ml.", source)
            self.assertNotIn("__file__", source)

    def test_prepare_is_idempotent_and_data_change_stops_reuse(self):
        first = self.ns["prepare_data"](self.config)
        path = self.config.prepared / "manifest.json"
        timestamp = path.stat().st_mtime_ns
        self.assertEqual(self.ns["prepare_data"](self.config), first)
        self.assertEqual(path.stat().st_mtime_ns, timestamp)
        Image.new("RGB", (8, 8), (255, 255, 255)).save(self.config.raw / "ok_front/00.png")
        with self.assertRaises(ValueError):
            self.ns["load_manifest"](self.config)

    def test_augmentation_reaches_train_for_both_architectures_only(self):
        manifest = self.ns["prepare_data"](self.config)
        make_dataset = MagicMock()
        with patch.dict(
            self.ns,
            {
                "make_tf_dataset": make_dataset,
                "cache_training_images": lambda config, manifest: {
                    row["path"]: config.root / row["path"] for row in manifest["rows"]
                },
            },
        ):
            self.ns["datasets"](self.config, manifest, augmentation=self.config.augmentation)
        train, validation, test = make_dataset.call_args_list
        self.assertTrue(train.kwargs["augment"])
        self.assertTrue(train.kwargs["training"])
        self.assertFalse(validation.kwargs["augment"])
        self.assertFalse(test.kwargs["augment"])
        self.assertTrue(set(train.args[0]).isdisjoint(test.args[0]))
        for name in ("train", "run_hpo"):
            self.assertIn(name, self.ns)

    def test_training_cache_and_incomplete_run_protection(self):
        self.ns["prepare_data"](self.config)
        model = MagicMock()
        fake_tf = MagicMock()
        fake_tf.keras.models.load_model.return_value.predict.return_value = np.array([[0.2], [0.8]])

        def fit(*args, **kwargs):
            directory = next((self.root / "models/experiments").iterdir())
            (directory / "best.keras").write_bytes(b"checkpoint")
            (directory / "history.csv").write_text("epoch,loss\n0,0.1\n")

        model.fit.side_effect = fit
        with patch.dict(
            self.ns,
            {
                "tf": fake_tf,
                "runtime_versions": lambda: {"tensorflow": "test"},
                "notebook_code_fingerprint": lambda kind: "stable-code",
                "datasets": MagicMock(return_value={"train": [], "validation": [], "test": []}),
                "build_model": MagicMock(return_value=model),
                "choose_threshold": MagicMock(return_value=0.5),
                "scores": MagicMock(return_value={"recall": 1.0}),
            },
        ):
            directory = self.ns["train"](self.config)
            self.assertEqual(directory, self.ns["train"](self.config))
            model.fit.assert_called_once()
            started = self.ns["read_json"](directory / "started.json")
            self.assertTrue(started["params"]["augmentation"])
            self.assertIn("created_utc", started)
            (directory / "completed.json").unlink()
            with self.assertRaisesRegex(RuntimeError, "incompleta"):
                self.ns["train"](self.config)
            model.fit.assert_called_once()

    def test_code_fingerprint_stable_after_all_cells(self):
        cnn = self.ns["notebook_code_fingerprint"]("cnn")
        mobile = self.ns["notebook_code_fingerprint"]("mobilenetv2")
        self.assertEqual(cnn, self.ns["notebook_code_fingerprint"]("cnn"))
        self.assertNotEqual(cnn, mobile)

    def test_colab_cache_reuses_verified_images_and_repairs_changed_copy(self):
        manifest = self.ns["prepare_data"](self.config)
        shutil_module = self.ns["shutil"]
        with (
            patch.dict(self.ns, {"USE_LOCAL_IMAGE_CACHE": True, "LOCAL_IMAGE_CACHE": self.root / "session-cache"}),
            patch.object(shutil_module, "copyfile", wraps=shutil_module.copyfile) as copy,
        ):
            first = self.ns["cache_training_images"](self.config, manifest)
            self.assertEqual(copy.call_count, 40)
            self.assertEqual(first, self.ns["cache_training_images"](self.config, manifest))
            self.assertEqual(copy.call_count, 40)
            next(iter(first.values())).write_bytes(b"broken local cache")
            self.ns["cache_training_images"](self.config, manifest)
            self.assertEqual(copy.call_count, 41)

    def test_export_uses_isolated_interpreter(self):
        source = next(
            "".join(c["source"]) for c in self.notebook["cells"] if "def export_tfjs(" in "".join(c["source"])
        )
        self.assertIn("str(converter_python)", source)
        node = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == "export_tfjs")
        self.assertNotIn("TFJS_COMPAT_BOOTSTRAP", ast.unparse(node))

    def test_dvc_unchanged_retries_pending_upload(self):
        (self.root / ".dvc").mkdir()
        (self.root / "data.dvc").write_text("stable-pointer")
        command = MagicMock(side_effect=["drive /remote", "", ""])
        with patch.dict(self.ns, {"command": command}), patch.object(self.ns["shutil"], "which", return_value="dvc"):
            result = self.ns["version_with_dvc"](self.config, self.root / "data", push=True, remote="drive")
        self.assertFalse(result["updated"])
        self.assertFalse(any(call.args[1][:2] == ["dvc", "status"] for call in command.call_args_list))
        self.assertEqual(command.call_args_list[-1].args[1][:2], ["dvc", "push"])
