import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from media import inspect_media


class MediaStreamTests(unittest.TestCase):
    def test_codec_decisions_describe_the_first_mapped_streams(self):
        probe = {'format':{'duration':'30'}, 'streams':[
            {'codec_type':'video', 'codec_name':'hevc', 'pix_fmt':'yuv420p10le', 'width':1920, 'height':1080},
            {'codec_type':'audio', 'codec_name':'ac3'},
            {'codec_type':'video', 'codec_name':'h264', 'pix_fmt':'yuv420p', 'width':320, 'height':240},
            {'codec_type':'audio', 'codec_name':'aac'}]}
        with patch('media.tool_path', return_value='ffprobe'), patch('media.subprocess.run', return_value=SimpleNamespace(stdout=json.dumps(probe))):
            technical = inspect_media(Path('multi.mkv'), Path('.'))['technical']
        self.assertEqual(technical['video_codec'], 'hevc')
        self.assertEqual(technical['pixel_format'], 'yuv420p10le')
        self.assertEqual(technical['audio_codec'], 'ac3')
        self.assertEqual(technical['width'], 1920)
