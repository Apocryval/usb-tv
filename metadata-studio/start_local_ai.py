"""Start the configured portable Ollama in the background, without global settings."""
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.parse
import urllib.request


def start(config):
    if not config.get('ai_root'):
        return
    root = Path(config['ai_root']).resolve()
    executable = root / 'ollama' / 'ollama.exe'
    if not executable.is_file():
        raise RuntimeError(f'Ollama is missing: {executable}')
    url = config.get('ollama_url', 'http://127.0.0.1:11434').rstrip('/')
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'http' or parsed.hostname not in ('localhost', '127.0.0.1') or parsed.path or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Portable Ollama must use a local loopback URL.')
    http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def ready():
        try:
            with http.open(url + '/api/version', timeout=1) as response:
                return isinstance(json.load(response).get('version'), str)
        except (OSError, ValueError):
            return False
    if ready():
        print('Local Ollama is already running.')
        return
    for name in ('ollama-models', 'logs', 'tmp'):
        (root / name).mkdir(exist_ok=True)
    env = dict(os.environ, OLLAMA_MODELS=str(root/'ollama-models'), OLLAMA_NO_CLOUD='1',
               OLLAMA_HOST=f'127.0.0.1:{parsed.port or 11434}', OLLAMA_CONTEXT_LENGTH=str(config.get('context_length',8192)),
               TEMP=str(root/'tmp'), TMP=str(root/'tmp'))
    with (root/'logs'/'ollama.out.log').open('a') as output, (root/'logs'/'ollama.err.log').open('a') as errors:
        process = subprocess.Popen([str(executable),'serve'],cwd=executable.parent,env=env,
            stdin=subprocess.DEVNULL,stdout=output,stderr=errors,creationflags=subprocess.CREATE_NO_WINDOW)
    for _ in range(40):
        time.sleep(.5)
        if process.poll() is not None:
            raise RuntimeError(f'Ollama exited. See {root / "logs" / "ollama.err.log"}')
        if ready():
            print(f'Local Ollama started. Model storage: {root / "ollama-models"}')
            return
    raise RuntimeError(f'Ollama did not become ready. See {root / "logs" / "ollama.err.log"}')


if __name__ == '__main__':
    start(json.loads((Path(__file__).parent/'config.json').read_text(encoding='utf-8')))
