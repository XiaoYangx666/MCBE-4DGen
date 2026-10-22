"""Keep only the generated 128px model confirmed visible by the user's screenshot."""
import hashlib
import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKS = Path(os.environ.get('SKIN_PACKS_ROOT', r'D:\Minecraft\Content\data\skin_packs'))
def inventory(folder):
    return {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in folder.rglob('*') if p.is_file()}
def write(p, data):
    p.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')

CUSTOM_STAMP = os.environ.get('CLIENT_CUSTOM_STAMP', 'current-custom')
PERSONA_STAMP = os.environ.get('CLIENT_PERSONA_STAMP', 'current-persona')

for slot, sample, stamp in [('custom', 'avocado', CUSTOM_STAMP),
                            ('persona', 'shino', PERSONA_STAMP)]:
    target = PACKS / slot
    receipt_path = ROOT / '.cache/client-backups' / stamp / 'receipt.json'
    receipt = json.loads(receipt_path.read_text())
    assert Path(receipt['target']) == target
    assert inventory(target) == receipt['deployed'], 'Target changed; refusing overwrite'
    checkpoint = receipt_path.parent / 'before-finalize'
    assert not checkpoint.exists(), 'Already finalized'
    shutil.copytree(target, checkpoint)
    shutil.copy2(receipt_path, receipt_path.parent / 'receipt-before-finalize.json')
    geometry = json.loads((target / 'geometry.json').read_text())
    skins = json.loads((target / 'skins.json').read_text())
    entry = next(e for e in skins['skins'] if e['localization_name'] == 'generated128')
    entry['texture'] = 'skin0.png'
    skins['skins'] = [entry]
    identifier = entry['geometry']
    manifest = json.loads((target / 'manifest.json').read_text())
    manifest['header']['version'] = [1, 0, 3]
    manifest['modules'][0]['version'] = [1, 0, 3]
    try:
        shutil.copy2(target / 'generated128.png', target / 'skin0.png')
        write(target / 'geometry.json', {'format_version': '1.8.0', identifier: geometry[identifier]})
        write(target / 'skins.json', skins)
        write(target / 'manifest.json', manifest)
        key = skins['localization_name']
        for locale in ['en_US', 'zh_CN']:
            (target / 'texts' / (locale + '.lang')).write_text(
                'skinpack.' + key + '=4DTest ' + sample + '\n' +
                'skin.' + key + '.generated128=' + sample + ' (128)\n', encoding='utf-8')
        for name in ['control64.png', 'reference128.png', 'generated128.png']:
            (target / name).unlink()
        receipt['deployed'] = inventory(target)
        receipt['trial'] = 'generated128 only; user screenshot confirms model visible, wearing pending'
        write(receipt_path, receipt)
    except Exception:
        shutil.copytree(checkpoint, target, dirs_exist_ok=True)
        shutil.copy2(receipt_path.parent / 'receipt-before-finalize.json', receipt_path)
        raise
    print(slot, sample, '128px generated model retained; restore receipt updated')
