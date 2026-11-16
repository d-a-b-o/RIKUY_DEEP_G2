import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "dast", Path(__file__).resolve().parents[1] / "dast_preview.py"
)
dast = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dast)


class PreviewTests(unittest.TestCase):
    def setUp(self):
        self.event = {
            "deployment": {
                "creator": {"login": "vercel[bot]"},
                "environment": "Preview",
                "sha": "a" * 40,
            },
            "deployment_status": {
                "state": "success",
                "environment_url": "https://rikuy-abc.vercel.app",
            },
        }
        self.prs = [
            {
                "number": 3,
                "state": "open",
                "head": {"sha": "a" * 40, "repo": {"full_name": "org/repo"}},
                "base": {"repo": {"full_name": "org/repo"}},
            }
        ]

    def check(self):
        return dast.validate(self.event, "rikuy", "org/repo", self.prs)

    def test_valid_preview(self):
        self.assertEqual(self.check()["pr"], "3")

    def test_fork_stale_or_closed_pr_never_gets_secret(self):
        for change in ("fork", "sha", "closed"):
            with self.subTest(change=change):
                original = copy.deepcopy(self.prs)
                if change == "fork":
                    self.prs[0]["head"]["repo"]["full_name"] = "outsider/fork"
                if change == "sha":
                    self.prs[0]["head"]["sha"] = "b" * 40
                if change == "closed":
                    self.prs[0]["state"] = "closed"
                self.assertIsNone(self.check())
                self.prs = original

    def test_untrusted_urls_rejected(self):
        for url in (
            "http://rikuy-abc.vercel.app",
            "https://rikuy-abc.vercel.app.evil.com",
            "https://127.0.0.1",
            "https://rikuy-abc.vercel.app/\n",
            "https://other-abc.vercel.app",
            "https://u:p@rikuy-abc.vercel.app",
            "https://rikuy-abc.vercel.app:443",
            "https://rikuy-abc.vercel.app/?secret=x",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.event["deployment_status"]["environment_url"] = url
                self.check()

    def test_wrong_actor_or_production_skipped(self):
        self.event["deployment"]["creator"]["login"] = "attacker"
        self.assertIsNone(self.check())
        self.event["deployment"]["creator"]["login"] = "vercel[bot]"
        self.event["deployment"]["production_environment"] = True
        self.assertIsNone(self.check())
