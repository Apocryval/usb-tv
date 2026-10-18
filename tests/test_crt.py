import tempfile
import unittest

from catalogue import Catalogue, normalise_settings


class CRTSettingsTests(unittest.TestCase):
    def test_existing_toggle_migrates_to_classic(self):
        self.assertEqual(normalise_settings({'crt': True})['crt_mode'], 'classic')
        self.assertEqual(normalise_settings({'crt': False})['crt_mode'], 'off')
        self.assertEqual(normalise_settings({'crt_mode': 'unknown'})['crt_mode'], 'off')

    def test_three_modes_survive_save_and_restart(self):
        with tempfile.TemporaryDirectory() as root:
            library = Catalogue(root)
            for mode in ('classic', 'realistic', 'off'):
                data = library.read()
                data['settings'].update(crt_mode=mode, crt=mode != 'off')
                library.save_edits(data)
                saved = Catalogue(root).read()['settings']
                self.assertEqual(saved['crt_mode'], mode)
                self.assertEqual(saved['crt'], mode != 'off')

    def test_legacy_interface_can_still_switch_off(self):
        self.assertEqual(normalise_settings({'crt_mode': 'realistic', 'crt': False})['crt_mode'], 'off')
