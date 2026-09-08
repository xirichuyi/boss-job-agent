import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('scheduler', Path(__file__).resolve().parents[1] / 'scripts/scheduler.py')
scheduler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scheduler)


class SchedulerTests(unittest.TestCase):
    def test_success(self):
        self.assertEqual(scheduler.run_worker(['/usr/bin/true'], 2), 0)

    def test_failure(self):
        self.assertEqual(scheduler.run_worker(['/usr/bin/false'], 2), 1)

    def test_deadline(self):
        self.assertEqual(scheduler.run_worker(['/usr/bin/sleep', '5'], .05), 124)

    def test_private_atomic_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            scheduler.atomic_json(path, {'state': 'running'})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(scheduler.json.loads(path.read_text())['state'], 'running')


if __name__ == '__main__':
    unittest.main()
