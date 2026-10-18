import sys
from pathlib import Path as _TestPath
sys.path.insert(0, str(_TestPath(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(_TestPath(__file__).resolve().parents[1] / "scripts"))
import tempfile
import unittest
from pathlib import Path
from catalogue import Catalogue, normalise_episodes
import broadcasts
import copy
from test_catalogue import mp4
from unittest.mock import patch


class EpisodeTests(unittest.TestCase):
    def test_old_content_edits_cannot_restore_markers_during_a_replacement_scan(self):
        with tempfile.TemporaryDirectory() as folder:
            library = Catalogue(folder, organise_new=False)
            path = Path(folder) / 'Videos/season.mp4'
            path.write_bytes(mp4(3600))
            with patch('media.tool_path', return_value=None):
                baseline = library.scan()
            candidate = copy.deepcopy(baseline)
            candidate['videos'][0].update(fingerprint='replacement', duration=300, episodes=[], episode_review='unchecked')
            library.save_edits({'videos':[{'id':baseline['videos'][0]['id'], 'title':'Concurrent label',
                'episode_review':'multiple', 'episodes':[{'title':'One','start':0,'end':1800}, {'title':'Two','start':1800,'end':3600}]}]})
            result = library.commit_scan(candidate, baseline)['videos'][0]
            self.assertEqual(result['title'], 'Concurrent label')
            self.assertEqual(result['episodes'], [])
            self.assertEqual(result['episode_review'], 'unchecked')
            self.assertEqual(result['duration'], 300)

    def test_replacing_a_file_resets_markers_preserves_labels_and_allows_saves(self):
        with tempfile.TemporaryDirectory() as folder:
            library = Catalogue(folder, organise_new=False)
            path = Path(folder) / 'Videos/season.mp4'
            path.write_bytes(mp4(3600))
            with patch('media.tool_path', return_value=None):
                data = library.scan()
            item = data['videos'][0]
            item.update(title='Chosen title', channels=['A'], episode_review='multiple',
                        episodes=[{'title':'One','start':0,'end':1800}, {'title':'Two','start':1800,'end':3600}])
            library.save_edits(data)
            path.write_bytes(mp4(300, 'Shortened edit'))
            with patch('media.tool_path', return_value=None):
                replaced = library.scan()
            video = replaced['videos'][0]
            self.assertEqual(video['id'], item['id'])
            self.assertEqual(video['title'], 'Chosen title')
            self.assertEqual(video['channels'], ['A'])
            self.assertEqual(video['duration'], 300)
            self.assertEqual(video['episodes'], [])
            self.assertEqual(video['episode_review'], 'unchecked')
            self.assertEqual(video['previous_episode_metadata']['episodes'], item['episodes'])
            replaced['settings']['theme'] = 'goblin'
            self.assertEqual(library.save_edits(replaced)['settings']['theme'], 'goblin')

    def test_invalid_markers(self):
        for episodes in ([{'title':'E','start':0,'end':float('nan')}],
                         [{'title':'E','start':0,'end':3601}],
                         [{'title':'','start':0,'end':100}],
                         [{'title':'E','start':0,'end':100},{'title':'F','start':99,'end':200}]):
            with self.assertRaises(ValueError):
                normalise_episodes(episodes,3600)

    def test_saved_markers_survive_scan_merge_and_can_be_dismissed(self):
        with tempfile.TemporaryDirectory() as folder:
            library=Catalogue(Path(folder),organise_new=False)
            item={'id':'000001','file':'Videos/season.mp4','duration':3600,'type':'programme',
                  'title':'Season','genres':['Comedy'],'channels':['A'],'tags':[]}
            baseline={'version':2,'next_id':2,'settings':{},'channels':[{'name':'A'}],'videos':[item]}
            library.write(baseline)
            episodes=[{'title':'E1','start':0,'end':1700},{'title':'E2','start':1700,'end':3600}]
            saved=library.save_edits({'videos':[dict(item,episode_review='multiple',episodes=episodes)]})
            self.assertEqual(saved['videos'][0]['episodes'],episodes)
            merged=library.commit_scan(baseline,baseline)
            self.assertEqual(merged['videos'][0]['episode_review'],'multiple')
            self.assertEqual(merged['videos'][0]['episodes'],episodes)
            saved=library.save_edits({'videos':[{'id':'000001','episode_review':'single'}]})
            self.assertEqual(saved['videos'][0]['episode_review'],'single')
            self.assertEqual(saved['videos'][0]['episodes'],episodes)

    def test_invalid_broadcast_markers_rejected(self):
        video={'id':'one','duration':3600,'channels':['A'],'type':'programme','break_points':[],
               'episodes':[{'title':'E','start':0,'end':4000}]}
        channels={'A':{'active':{'anchor':0,'seed':'A','snapshot':{
            'channel':{'name':'A','ad_interval':900,'ad_length':0},'videos':[video]}},'pending':None}}
        with self.assertRaises(ValueError):
            broadcasts.validate(channels)
