#!/usr/bin/env python3
"""Disposable real-server UX fixture. Never reads the personal catalogue or media.

Run: python3 tests/serve_ux_fixture.py [--port 8769]
Needs FFmpeg/FFprobe. Prints its temporary library path and URL; Ctrl+C stops it.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import argparse
import hashlib
import json
import subprocess
import tempfile
from types import SimpleNamespace

import server
from catalogue import Catalogue


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8769)
    options = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='usbtv-ux-') as directory:
        root = Path(directory)
        (root / 'data').mkdir()
        library = Catalogue(root, organise_new=False)
        for name, codec, colour in [('aac.mp4','aac','navy'),('dolby.mkv','eac3','darkgreen')]:
            subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
                '-f','lavfi','-i',f'color=c={colour}:size=320x180:rate=12',
                '-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
                '-t','180','-c:v','libx264','-preset','ultrafast','-c:a',codec,
                '-af','volume=0.04','-ac','2' if codec=='aac' else '6',str(root/'Videos'/name)],check=True)
        (root/'Videos'/'broken.mkv').write_bytes(b'invalid media')
        library.scan()
        catalog = library.read()
        for video in catalog['videos']:
            broken = video['file'].endswith('broken.mkv')
            video.update(title={'aac.mp4':'Moonlight — AAC','dolby.mkv':'Forest — Dolby 5.1','broken.mkv':'Broken <script> recording'}[Path(video['file']).name],
                         genres=['Tests' if broken else 'Science'],tags=['broken' if broken else 'night'],
                         channels=[] if broken else ['Test channel'],description='Isolated UX test recording.')
        # Missing media stays out of playback; corruption was assessed by the real scanner.
        catalog['videos'].append({'id':'missing','file':'Videos/missing.mp4','fingerprint':'missing',
            'title':'Missing recording','duration':30,'missing':True,'type':'programme','genres':['Tests'],'tags':[],'channels':[]})
        catalog['channels']=[{'name':'Test channel'}]
        catalog['genres']=['Science','Tests']
        catalog['settings'].update(theme='satellite',advanced_mode=True,auto_imports=False,volume_levelling=True)
        library.write(catalog)
        server.LIBRARY=library
        # Fixed scan status makes this fixture deterministic; mutations still use real handlers.
        server.SCANS=SimpleNamespace(status=lambda:{'status':'idle'},thread=None,start=lambda **kwargs:{'status':'idle'})
        originals={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'Videos').iterdir()}
        http=server.SessionServer(('127.0.0.1',options.port),server.Handler)
        print(json.dumps({'url':f'http://127.0.0.1:{http.server_port}/','library':directory,
                          'videos':[{'id':v['id'],'title':v['title']} for v in catalog['videos']]}),flush=True)
        try:
            http.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            http.stopping.set()
            if hasattr(http,'playback_audio'): http.playback_audio.close()
            http.server_close()
            changed=[p for p,digest in originals.items() if not Path(p).exists() or hashlib.sha256(Path(p).read_bytes()).hexdigest()!=digest]
            print(json.dumps({'original_files_unchanged':not changed}),flush=True)


if __name__=='__main__': main()
