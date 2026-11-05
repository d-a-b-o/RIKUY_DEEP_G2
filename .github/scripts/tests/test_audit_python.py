"""Exercise the actual orchestration with isolated reports and fake API responses."""

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError, URLError

spec = importlib.util.spec_from_file_location(
    "audit_python", Path(__file__).resolve().parents[1] / "audit_python.py"
)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def report(vulns=None):
    return {"dependencies": [{"name": "demo", "version": "1.0", "vulns": vulns or []}]}


VULN = {"id": "PYSEC-2026-1", "aliases": ["GHSA-abcd-1234-5678"], "fix_versions": ["2.0"]}


def advisory(level):
    return {"ghsa_id": "GHSA-abcd-1234-5678", "severity": level, "withdrawn_at": None}


class SeverityTests(unittest.TestCase):
    def test_high_critical_block_and_low_moderate_pass(self):
        for level, blocking in [("low", False), ("moderate", False), ("high", True), ("critical", True)]:
            with self.subTest(level=level):
                rows = audit.evaluate(report([VULN]), lambda v: audit.severity_for(v, lambda _: advisory(level)))
                self.assertEqual(rows[0]["blocking"], blocking)
                self.assertEqual(rows[0]["fix_versions"], ["2.0"])

    def test_medium_label_is_normalized(self):
        self.assertEqual(audit.severity_for(VULN, lambda _: advisory("medium"))[0], "moderate")

    def test_cve_fallback(self):
        paths = []
        def fetch(path):
            paths.append(path)
            return [advisory("high")]
        self.assertEqual(audit.severity_for({"id": "CVE-2026-1234"}, fetch)[0], "high")
        self.assertIn("cve_id=CVE-2026-1234", paths[0])

    def test_missing_unknown_and_withdrawn_severity_rejected(self):
        for record in [advisory("unknown"), {"severity": None}, {**advisory("low"), "withdrawn_at": "date"}]:
            with self.subTest(record=record), self.assertRaises(ValueError):
                audit.severity_for(VULN, lambda _: record)
        with self.assertRaises(ValueError):
            audit.severity_for({"id": "PYSEC-2026-1"}, lambda _: [])

    def test_empty_and_skipped_dependencies_rejected(self):
        for data in [{"dependencies": []}, {"dependencies": [{"name": "demo", "skip_reason": "missing"}]}]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                audit.evaluate(data, lambda _: ("low", []))

    def test_api_failure_is_not_treated_as_low(self):
        for error in [URLError("offline"), HTTPError("url", 429, "rate limit", {}, None)]:
            def fetch(_):
                raise error
            with self.assertRaises(OSError):
                audit.severity_for(VULN, fetch)


class OrchestrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.requirements = self.root / "ml"
        self.requirements.mkdir()
        self.output = self.root / "reports"
        for name in ["ci", "publish", "regression", "train"]:
            (self.requirements / f"requirements-{name}.txt").write_text("demo==1.0\n")

    def runner(self, data, exit_code):
        def run(command, **kwargs):
            self.calls.append(command)
            Path(command[command.index("--output") + 1]).write_text(json.dumps(data))
            return subprocess.CompletedProcess(command, exit_code)
        return run

    def test_all_files_separate_and_transitive_findings_supported(self):
        self.calls = []
        # The reported dependency need not be a direct requirement.
        data = {"dependencies": [{"name": "transitive", "version": "1", "vulns": [VULN]}]}
        code = audit.audit(self.requirements, self.output, self.runner(data, 1), lambda _: advisory("moderate"))
        self.assertEqual(code, 0)
        self.assertEqual(len(self.calls), 4)
        self.assertTrue(all(command.count("-r") == 1 for command in self.calls))
        self.assertTrue(all("--strict" in command for command in self.calls))

    def test_high_findings_fail_but_all_files_are_audited(self):
        self.calls = []
        code = audit.audit(self.requirements, self.output, self.runner(report([VULN]), 1), lambda _: advisory("high"))
        self.assertEqual(code, 1)
        self.assertEqual(len(self.calls), 4)

    def test_clean_reports_pass(self):
        self.calls = []
        self.assertEqual(audit.audit(self.requirements, self.output, self.runner(report(), 0)), 0)

    def test_missing_invalid_skipped_and_inconsistent_reports_fail(self):
        for data, code in [(report(), 1), (report([VULN]), 0), ({}, 0),
                           ({"dependencies": [{"skip_reason": "missing"}]}, 0), (report(), 2)]:
            with self.subTest(data=data, code=code):
                self.calls = []
                self.assertEqual(audit.audit(self.requirements, self.output, self.runner(data, code),
                                             lambda _: advisory("low")), 1)

    def test_missing_report_does_not_reuse_stale_data(self):
        self.output.mkdir()
        (self.output / "requirements-ci.json").write_text(json.dumps(report()))
        def runner(command, **kwargs):
            return subprocess.CompletedProcess(command, 1)
        self.assertEqual(audit.audit(self.requirements, self.output, runner), 1)

    def test_no_requirements_fails(self):
        with self.assertRaises(ValueError):
            audit.audit(self.output, self.output)
