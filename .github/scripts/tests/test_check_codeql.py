"""Synthetic SARIF tests: no vulnerable application code is needed."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    'check_codeql', Path(__file__).resolve().parents[1] / 'check_codeql.py'
)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class SeverityGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def report(self, score, *, results=True, filename='results.sarif'):
        rule = {'id': 'test/security', 'properties': {}}
        if score is not None:
            rule['properties']['security-severity'] = score
        report = {'runs': [{
            'tool': {'driver': {'name': 'CodeQL', 'rules': [rule]}},
            'results': [{'ruleId': rule['id'], 'level': 'warning'}] if results else [],
        }]}
        (self.directory / filename).write_text(json.dumps(report), encoding='utf-8')

    def report_with_extension_rule(self, score, *, filename='results.sarif'):
        rule = {'id': 'ext/security', 'properties': {'security-severity': score}}
        report = {'runs': [{
            'tool': {
                'driver': {'name': 'CodeQL', 'rules': []},
                'extensions': [{'name': 'queries', 'rules': [rule]}],
            },
            'results': [{'ruleId': rule['id'], 'level': 'warning'}],
        }]}
        (self.directory / filename).write_text(json.dumps(report), encoding='utf-8')

    def test_high_and_critical_fail_even_when_sarif_level_is_warning(self):
        for score in ['7.0', '8.9', '9.0', '10.0']:
            with self.subTest(score=score):
                self.report(score)
                self.assertEqual(gate.check(self.directory), 1)

    def test_lower_severities_and_non_security_queries_pass(self):
        for score in ['0.0', '3.9', '4.0', '6.9', None]:
            with self.subTest(score=score):
                self.report(score)
                self.assertEqual(gate.check(self.directory), 0)

    def test_no_findings_pass(self):
        self.report('9.0', results=False)
        self.assertEqual(gate.check(self.directory), 0)

    def test_any_report_can_block(self):
        self.report('2.0', filename='javascript.sarif')
        self.report('9.0', filename='python.sarif')
        self.assertEqual(gate.check(self.directory), 1)

    def test_rules_from_extensions_are_supported(self):
        self.report_with_extension_rule('9.0')
        self.assertEqual(gate.check(self.directory), 1)

    def test_missing_report_fails_closed(self):
        with self.assertRaises(ValueError):
            gate.check(self.directory)

    def test_malformed_or_incomplete_report_fails_closed(self):
        for report in ['invalid json', '{"runs": []}']:
            with self.subTest(report=report):
                (self.directory / 'bad.sarif').write_text(report, encoding='utf-8')
                with self.assertRaises(ValueError):
                    gate.check(self.directory)

    def test_invalid_severity_fails_closed(self):
        for score in ['high', 'NaN', 'Infinity', '-1', '11']:
            with self.subTest(score=score):
                self.report(score)
                with self.assertRaises(ValueError):
                    gate.check(self.directory)


if __name__ == '__main__':
    unittest.main()
