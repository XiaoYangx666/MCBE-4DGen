"""Install the generated Shino rigid humanoid trial while retaining original restore support."""
import hashlib
import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = Path(r'D:\Minecraft\Content\data\skin_packs\persona')
RECEIPT = ROOT / '.cache/client-backups/<timestamp>-persona/receipt.json'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--sample', choices=['shino-humanoid', 'shino-tuned', 'shino-source-owned', 'shino-natural'], default='shino-humanoid')
args = parser.parse_args()
tag = 'humanoid' if args.sample == 'shino-humanoid' else args.sample
def inventory(folder):
    return {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in folder.rglob('*') if p.is_file()}
def write(p, data):
    p.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')

receipt = json.loads(RECEIPT.read_text())
assert Path(receipt['target']) == TARGET
assert inventory(TARGET) == receipt['deployed'], 'Target changed; refusing overwrite'
checkpoint = RECEIPT.parent / ('before-' + tag)
assert not checkpoint.exists(), 'Humanoid trial already installed'
shutil.copytree(TARGET, checkpoint)
previous_receipt = RECEIPT.parent / ('receipt-before-' + tag + '.json')
shutil.copy2(RECEIPT, previous_receipt)
source = ROOT / 'outputs' / args.sample
geometry = json.loads((source / 'geometry.json').read_text())
identifier = 'geometry.fourdtest_' + args.sample.replace('-', '_')
geometry[identifier] = geometry.pop('geometry.skin0')
skins = json.loads((TARGET / 'skins.json').read_text())
skins['skins'] = [{'localization_name': 'humanoid', 'geometry': identifier,
                   'texture': 'skin0.png', 'hide_armor': True, 'type': 'free'}]
manifest = json.loads((TARGET / 'manifest.json').read_text())
manifest['header']['version'] = [1, 0, {'humanoid': 4, 'shino-tuned': 5, 'shino-source-owned': 6, 'shino-natural': 7}[tag]]
manifest['modules'][0]['version'] = list(manifest['header']['version'])
try:
    write(TARGET / 'geometry.json', geometry)
    write(TARGET / 'skins.json', skins)
    write(TARGET / 'manifest.json', manifest)
    shutil.copy2(source / 'skin0.png', TARGET / 'skin0.png')
    key = skins['localization_name']
    for locale in ['en_US', 'zh_CN']:
        (TARGET / 'texts' / (locale + '.lang')).write_text(
            'skinpack.' + key + '=4DTest ' + args.sample + '\n' +
            'skin.' + key + '.humanoid=Shino - ' + tag + '\n', encoding='utf-8')
    receipt['deployed'] = inventory(TARGET)
    receipt['trial'] = args.sample + '; client motion verification pending'
    write(RECEIPT, receipt)
except Exception:
    shutil.copytree(checkpoint, TARGET, dirs_exist_ok=True)
    shutil.copy2(previous_receipt, RECEIPT)
    raise
assert hashlib.sha256((TARGET / 'skin0.png').read_bytes()).digest() == hashlib.sha256((source / 'skin0.png').read_bytes()).digest()
assert len([b for b in geometry[identifier]['bones'] if b.get('poly_mesh')]) == 6
print('Persona humanoid deployed; six mesh bones and texture hash verified; original restore receipt updated')
