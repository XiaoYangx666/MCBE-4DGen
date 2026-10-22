"""Apply a reversible metadata compatibility trial to the deployed samples."""
import json
import os
import shutil
import uuid
from pathlib import Path
import hashlib

ROOT = Path(__file__).resolve().parents[2]
PACKS = Path(os.environ.get('SKIN_PACKS_ROOT', r'D:\Minecraft\Content\data\skin_packs'))
def inventory(folder):
    return {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in folder.rglob('*') if p.is_file()}
def write(p, value):
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

CUSTOM_STAMP = os.environ.get('CLIENT_CUSTOM_STAMP', 'current-custom')
PERSONA_STAMP = os.environ.get('CLIENT_PERSONA_STAMP', 'current-persona')

for slot, sample, stamp in [('custom', 'avocado', CUSTOM_STAMP),
                            ('persona', 'shino', PERSONA_STAMP)]:
    target = PACKS / slot
    receipt_path = ROOT / '.cache' / 'client-backups' / stamp / 'receipt.json'
    receipt = json.loads(receipt_path.read_text())
    assert Path(receipt['target']) == target
    assert inventory(target) == receipt['deployed'], 'Deployment changed; refusing overwrite'
    checkpoint = receipt_path.parent / 'before-metadata-trial'
    assert not checkpoint.exists(), 'Trial already applied'
    shutil.copytree(target, checkpoint)
    shutil.copy2(receipt_path, receipt_path.parent / 'receipt-before-metadata.json')
    manifest = json.loads((target / 'manifest.json').read_text())
    skins = json.loads((target / 'skins.json').read_text())
    geometry = json.loads((target / 'geometry.json').read_text())
    identifier = 'geometry.fourdtest_' + sample
    geometry[identifier] = geometry.pop('geometry.skin0')
    skins['skins'][0]['geometry'] = identifier
    skins['skins'][0]['localization_name'] = '4DTest_' + sample
    manifest['header']['uuid'] = str(uuid.uuid4())
    manifest['modules'][0]['uuid'] = str(uuid.uuid4())
    manifest['header']['name'] = '4DTest ' + sample
    manifest['header']['version'] = [1, 0, 1]
    manifest['modules'][0]['version'] = [1, 0, 1]
    if slot == 'custom':
        skins = {'skins': skins['skins']}
    else:
        manifest['format_version'] = 1
        manifest['header']['description'] = '4DTest Shino compatibility trial'
        skins['localization_name'] = '4DTest_Shino'
    try:
        write(target / 'manifest.json', manifest)
        write(target / 'skins.json', skins)
        write(target / 'geometry.json', geometry)
        receipt['deployed'] = inventory(target)
        receipt['trial'] = 'unique UUID + reference metadata + unique geometry identifiers'
        write(receipt_path, receipt)
    except Exception:
        shutil.copytree(checkpoint, target, dirs_exist_ok=True)
        shutil.copy2(receipt_path.parent / 'receipt-before-metadata.json', receipt_path)
        raise
    print(slot, manifest['header']['uuid'], identifier, 'backup and restore receipt updated')
