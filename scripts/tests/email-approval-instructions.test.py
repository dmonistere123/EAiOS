import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('approval_instructions', Path(__file__).resolve().parents[1] / 'update-email-approval-instructions.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class EmailInstructionPatch(unittest.TestCase):
    def test_preserves_customization_and_is_idempotent(self):
        original = ('Custom organization rules\n' + module.START + ' old gate\n' + module.END + '\nCustom scan rules\n'
            + 'hermes kanban create "<Reply — recipient/thread>" --body \'<envelope-json>\' --initial-status blocked --priority <1-4>\n'
            + module.PROVENANCE + '\nold checks\n' + module.RULES + '\nCustom delivery rules\n')
        updated = module.patch(original)
        self.assertIn('Custom organization rules', updated)
        self.assertIn('Custom scan rules', updated)
        self.assertIn('Custom delivery rules', updated)
        self.assertIn('--kind needs_input', updated)
        self.assertIn('approval_decided', updated)
        self.assertEqual(module.patch(updated), updated)

    def test_unrecognized_layout_is_not_overwritten(self):
        with self.assertRaises(ValueError):
            module.patch('Completely customized skill')

if __name__ == '__main__':
    unittest.main()
