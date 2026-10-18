"""Deploy named standard/reference/resized/original rendering controls, with rollback backups."""
import copy
import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKS = Path(r'D:\Minecraft\Content\data\skin_packs')
def inventory(folder):
    return {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in folder.rglob('*') if p.is_file()}
def write(p, data):
    p.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')

reference_text = (PACKS / 'reference-a' / 'geometry.json').read_text(encoding='utf-8-sig')
# The supplied reference has a trailing comma. Normalize only the in-memory diagnostic copy.
reference = json.loads(re.sub(r',\s*}\s*$', '}', reference_text))['geometry.skin0']
reference_texture = PACKS / 'reference-a' / 'skin0.png'
for slot, sample, stamp in [('custom', 'avocado', '<timestamp>-custom'),
                            ('persona', 'shino', '<timestamp>-persona')]:
    target = PACKS / slot
    receipt_path = ROOT / '.cache' / 'client-backups' / stamp / 'receipt.json'
    receipt = json.loads(receipt_path.read_text())
    assert Path(receipt['target']) == target
    assert inventory(target) == receipt['deployed'], 'Target changed; refusing overwrite'
    checkpoint = receipt_path.parent / '<checkpoint>'
    assert not checkpoint.exists(), 'Controls already deployed'
    shutil.copytree(target, checkpoint)
    shutil.copy2(receipt_path, receipt_path.parent / 'receipt-before-controls.json')
    geometry = json.loads((target / 'geometry.json').read_text())
    original_id = 'geometry.fourdtest_' + sample
    reduced_id = original_id + '_128'
    reference_id = 'geometry.fourdtest_reference_' + sample
    geometry[reduced_id] = copy.deepcopy(geometry[original_id])
    geometry[reduced_id]['texturewidth'] = 128
    geometry[reduced_id]['textureheight'] = 128
    geometry[reference_id] = copy.deepcopy(reference)
    key = 'FourDTest_' + sample
    entries = [
        ('control64', 'geometry.humanoid.custom', 'control64.png', '1 Standard orange (64)'),
        ('reference128', reference_id, 'reference128.png', '2 Reference model (128)'),
        ('generated128', reduced_id, 'generated128.png', '3 Generated ' + sample + ' (128)'),
        ('generatedOriginal', original_id, 'skin0.png', '4 Generated ' + sample + ' (original)'),
    ]
    skins = {'serialize_name': key, 'localization_name': key, 'skins': [
        {'localization_name': name, 'geometry': identifier, 'texture': texture, 'type': 'free'}
        for name, identifier, texture, label in entries]}
    manifest = json.loads((target / 'manifest.json').read_text())
    manifest['header']['version'] = [1, 0, 2]
    manifest['modules'][0]['version'] = [1, 0, 2]
    additions = ['control64.png', 'reference128.png', 'generated128.png',
                 'texts/en_US.lang', 'texts/zh_CN.lang', 'texts/languages.json']
    assert all(not (target / name).exists() for name in additions)
    try:
        shutil.copy2(ROOT / 'outputs/client-controls/control64.png', target / 'control64.png')
        shutil.copy2(reference_texture, target / 'reference128.png')
        shutil.copy2(ROOT / 'outputs/client-controls' / (sample + '128.png'), target / 'generated128.png')
        (target / 'texts').mkdir(exist_ok=True)
        lang = 'skinpack.' + key + '=4DTest ' + sample + ' diagnostics\n'
        lang += ''.join('skin.' + key + '.' + name + '=' + label + '\n' for name, _, _, label in entries)
        for locale in ['en_US', 'zh_CN']:
            (target / 'texts' / (locale + '.lang')).write_text(lang, encoding='utf-8')
        write(target / 'texts/languages.json', ['en_US', 'zh_CN'])
        write(target / 'geometry.json', geometry)
        write(target / 'skins.json', skins)
        write(target / 'manifest.json', manifest)
        receipt['deployed'] = inventory(target)
        receipt['trial'] = 'standard64/reference128/generated128/generatedOriginal controls'
        write(receipt_path, receipt)
    except Exception:
        for name in additions:
            (target / name).unlink(missing_ok=True)
        shutil.copytree(checkpoint, target, dirs_exist_ok=True)
        shutil.copy2(receipt_path.parent / 'receipt-before-controls.json', receipt_path)
        raise
    assert all(entry['geometry'] == 'geometry.humanoid.custom' or entry['geometry'] in geometry
               for entry in skins['skins'])
    print(slot, '4 controls deployed, original backup retained, restore receipt updated')
