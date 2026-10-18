import sys
from pathlib import Path as _TestPath
sys.path.insert(0, str(_TestPath(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(_TestPath(__file__).resolve().parents[1] / "scripts"))
import importlib.util
import json
from pathlib import Path
import platform
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('metadata_studio', Path(__file__).resolve().parents[1] / 'metadata-studio' / 'studio.py')
studio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(studio)


class MetadataPolicyTests(unittest.TestCase):
    def setUp(self):
        self.policy = studio.load_policy(studio.DEFAULTS)

    def record(self, **changes):
        value = dict(title='Clip', description='A clip.', genres=['Comedy'], channels=['CRTV', 'TTTV'],
                     tags=['SNL'], tagline='A sketch.', tagline_goblin='A grubby sketch.',
                     evidence='Sketch format.', uncertainties=[], type='programme', confidence=.8,
                     original_release_year=2004, release_evidence='Specific episode dated 2004 in supplied evidence.')
        return dict(value, **changes)

    def test_policy_contains_all_personal_channels_and_closed_genres(self):
        names = {channel['name'] for channel in self.policy['channels']}
        self.assertTrue({'TTTV', 'Goblin TV', 'CRTV'} <= names)
        self.assertNotIn('Interdimensional Customs', names)
        schema = studio.metadata_schema(self.policy)
        self.assertEqual(set(schema['properties']['channels']['items']['enum']), names)
        self.assertIn('Sketch Comedy', schema['properties']['genres']['items']['enum'])
        self.assertNotIn('physics', schema['properties']['genres']['items']['enum'])
        self.assertNotIn('tagline',schema['properties'])
        self.assertNotIn('tagline_goblin',schema['properties'])
        self.assertNotIn('tagline',schema['required'])

    def test_crtv_requires_pre_2005_release_and_evidence(self):
        self.assertIn('CRTV', studio.validate_metadata(self.record(), self.policy)['channels'])
        for changes in ({'original_release_year': 2005}, {'original_release_year': None}, {'release_evidence': ''}):
            value = studio.validate_metadata(self.record(**changes), self.policy)
            self.assertNotIn('CRTV', value['channels'])
            self.assertIn('TTTV', value['channels'])
            self.assertTrue(value['uncertainties'])

    def test_unknown_labels_and_invalid_confidence_are_rejected(self):
        for changes in ({'channels': ['Made up']}, {'genres': ['physics']}, {'confidence': True},
                        {'confidence': float('nan')}, {'original_release_year': True}, {'type': 'movie'}):
            with self.assertRaises(ValueError):
                studio.validate_metadata(self.record(**changes), self.policy)

    def test_external_programme_folder_mapping_and_adverts(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            root, external = base / 'library', base / 'hdd'
            root.mkdir(); external.mkdir(); (root/'Adverts').mkdir()
            (external/'clip.mp4').write_bytes(b'video')
            (root/'Adverts'/'ad.mp4').write_bytes(b'ad')
            (root/'video-folders.json').write_text(json.dumps({sys.platform+':'+platform.node():str(external)}))
            self.assertEqual(studio.source_path({'file':'Videos/clip.mp4'},root,{}), external/'clip.mp4')
            self.assertEqual(studio.source_path({'file':'Adverts/ad.mp4'},root,{}), root/'Adverts'/'ad.mp4')
            with self.assertRaises(ValueError):
                studio.source_path({'file':'Videos/../library/Adverts/ad.mp4'},root,{})

    def test_loopback_only_and_cloud_models_rejected(self):
        for changes in ({'ollama_url':'https://example.com'}, {'model':'qwen3-vl:235b-cloud'}):
            with self.assertRaises(ValueError):
                studio.Ollama(dict(studio.DEFAULTS, **changes))

    def test_trait_routing_applies_overlapping_rules_and_short_surreal_limit(self):
        traits={name:False for name in studio.TRAITS}
        value=self.record(content_traits=dict(traits,animated=True,predominantly_music=True,drag=True,snl=True))
        self.assertEqual(studio.route_traits(value,self.policy,200),['Cartoons',"Now That's What I Call Shit!",'TTTV','CRTV'])
        value=self.record(original_release_year=None,content_traits=dict(traits,short_surreal=True,absurd_humour=True))
        self.assertEqual(studio.route_traits(value,self.policy,45),['Interdimensional Cable','Goblin TV'])
        self.assertEqual(studio.route_traits(value,self.policy,90),['Interdimensional Cable'])
        value['content_traits']['tf2']=True
        self.assertIn('Goblin TV',studio.route_traits(value,self.policy,90))
        value['content_traits']['tf2']='yes'
        with self.assertRaises(ValueError):
            studio.route_traits(value,self.policy,90)

    def test_truncated_json_retries_compactly_and_keeps_diagnostic(self):
        client=studio.Ollama(studio.DEFAULTS)
        replies=[{'response':'{"summary":"truncated','done_reason':'length','prompt_eval_count':10,'eval_count':1600},
                 {'response':'{"summary":"Complete"}','done_reason':'stop','prompt_eval_count':20,'eval_count':5}]
        with tempfile.TemporaryDirectory() as folder, patch.object(studio,'HOME',Path(folder)), patch.object(client,'request',side_effect=replies) as request:
            value=client.generate('Summarise evidence',studio.SUMMARY)
            self.assertEqual(value,{'summary':'Complete'})
            self.assertEqual(client.usage['requests'],2)
            self.assertEqual(client.usage['output_tokens'],1605)
            self.assertEqual(request.call_args_list[1].args[1]['options']['num_predict'],3200)
            self.assertEqual(len(list((Path(folder)/'cache'/'response-errors').glob('*.json'))),1)
