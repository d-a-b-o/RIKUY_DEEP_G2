"""The CI gate must reject failures and unexpected skips in security checks."""

import copy
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "check_ci", Path(__file__).resolve().parents[1] / "check_ci.py"
)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def needs(web="true", ml="true"):
    result = {job: {"result": "success", "outputs": {}} for job in gate.JOBS}
    result["changes"]["outputs"] = {"web": web, "ml": ml}
    return result


class GateTests(unittest.TestCase):
    def test_all_success(self):
        for event in ("pull_request", "push", "workflow_dispatch"):
            with self.subTest(event=event):
                gate.validate(needs(), event, "User")

    def test_each_failure_or_cancellation_blocks(self):
        for job in gate.JOBS:
            for state in ("failure", "cancelled", "neutral", "unknown"):
                with self.subTest(job=job, state=state):
                    data = needs()
                    data[job]["result"] = state
                    with self.assertRaises(ValueError):
                        gate.validate(data, "pull_request", "User")

    def test_mandatory_security_and_change_detection_cannot_be_skipped(self):
        for job in ("changes", "codeql", "gitleaks"):
            with self.subTest(job=job):
                data = needs("false", "false")
                data[job]["result"] = "skipped"
                with self.assertRaises(ValueError):
                    gate.validate(data, "pull_request", "User")

    def test_ml_skip_when_changed_blocks_pip_audit_bypass(self):
        data = needs()
        data["ml"]["result"] = "skipped"
        with self.assertRaises(ValueError):
            gate.validate(data, "pull_request", "User")

    def test_web_skip_when_changed_blocks(self):
        data = needs()
        data["web"]["result"] = "skipped"
        with self.assertRaises(ValueError):
            gate.validate(data, "pull_request", "User")

    def test_docs_only_pr_allows_route_skips(self):
        data = needs("false", "false")
        for job in ("web", "ml", "convenciones"):
            data[job]["result"] = "skipped"
        gate.validate(data, "pull_request", "User")

    def test_pr_specific_controls_cannot_be_skipped(self):
        for job in ("archivos", "dependencias", "convenciones"):
            data = needs()
            data[job]["result"] = "skipped"
            with self.subTest(job=job), self.assertRaises(ValueError):
                gate.validate(data, "pull_request", "User")

    def test_bot_pr_can_skip_only_conventions(self):
        data = needs()
        data["convenciones"]["result"] = "skipped"
        gate.validate(data, "pull_request", "Bot")

    def test_main_and_manual_allow_non_pr_skips(self):
        for event in ("push", "workflow_dispatch"):
            data = needs()
            for job in ("convenciones", "archivos", "dependencias"):
                data[job]["result"] = "skipped"
            gate.validate(data, event, "")

    def test_manual_run_requires_web_and_ml(self):
        for job in ("web", "ml"):
            data = needs("false", "false")
            data[job]["result"] = "skipped"
            with self.subTest(job=job), self.assertRaises(ValueError):
                gate.validate(data, "workflow_dispatch", "")

    def test_missing_jobs_outputs_and_unknown_event_fail(self):
        data = needs()
        del data["ml"]
        with self.assertRaises(ValueError):
            gate.validate(data, "pull_request", "User")
        for outputs in ({}, {"ml": "", "web": "true"}):
            data = copy.deepcopy(needs())
            data["changes"]["outputs"] = outputs
            with self.assertRaises((ValueError, KeyError)):
                gate.validate(data, "pull_request", "User")
        with self.assertRaises(ValueError):
            gate.validate(needs(), "unknown", "User")
