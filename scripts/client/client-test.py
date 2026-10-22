"""Back up, deploy and restore only the explicitly selected built-in skin pack."""
import argparse
import hashlib
import json
import os
import shutil
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKS = Path(os.environ.get('SKIN_PACKS_ROOT', r'D:\Minecraft\Content\data\skin_packs'))
def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()
def inventory(folder):
    if any(p.is_symlink() or p.is_junction() for p in folder.rglob('*')):
        raise RuntimeError('Links are not supported')
    return {p.relative_to(folder).as_posix(): digest(p) for p in folder.rglob('*') if p.is_file()}
def write_json(p, value):
    p.write_text(json.dumps(value, indent=2), encoding='utf-8')

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('action', choices=['deploy', 'restore'])
parser.add_argument('--slot', choices=['custom', 'persona'], default='custom')
parser.add_argument('--sample', choices=['avocado', 'shino'], default='avocado')
parser.add_argument('--receipt', type=Path)
args = parser.parse_args()
target = PACKS / args.slot
assert target.resolve() == target and target.parent == PACKS
if args.action == 'deploy':
    source = ROOT / 'outputs' / args.sample
    skins = json.loads((target / 'skins.json').read_text(encoding='utf-8-sig'))
    if skins.get('skins'):
        raise RuntimeError('Slot is occupied; restore it before deploying again')
    original = inventory(target)
    backup = ROOT / '.cache' / 'client-backups' / (datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '-' + args.slot)
    backup.mkdir(parents=True)
    shutil.copytree(target, backup / 'original')
    assert inventory(backup / 'original') == original
    generated = json.loads((source / 'skins.json').read_text())
    skins['skins'] = generated['skins']
    # Keep the original manifest UUID and pack-level loading identifiers.
    for name in ['geometry.json', 'skin0.png']:
        if (target / name).exists():
            raise RuntimeError('Refusing to overwrite existing asset: ' + name)
    receipt = {'target': str(target), 'sample': args.sample, 'original': original, 'deployed': None}
    write_json(backup / 'receipt.json', receipt)
    try:
        for name in ['geometry.json', 'skin0.png']:
            shutil.copy2(source / name, target / name)
        write_json(target / 'skins.json', skins)
        receipt['deployed'] = inventory(target)
        for name in ['geometry.json', 'skin0.png']:
            assert digest(source / name) == digest(target / name)
        write_json(backup / 'receipt.json', receipt)
    except Exception:
        for name in ['geometry.json', 'skin0.png']:
            (target / name).unlink(missing_ok=True)
        shutil.copy2(backup / 'original' / 'skins.json', target / 'skins.json')
        raise
    print(backup / 'receipt.json')
else:
    if not args.receipt:
        parser.error('restore requires --receipt')
    receipt_path = args.receipt.resolve()
    receipt = json.loads(receipt_path.read_text())
    if Path(receipt['target']) != target:
        raise RuntimeError('Receipt slot mismatch')
    original_dir = receipt_path.parent / 'original'
    assert inventory(original_dir) == receipt['original'], 'Backup integrity mismatch'
    if inventory(target) != receipt['deployed']:
        raise RuntimeError('Target changed since deployment; refusing to overwrite changes')
    for name in receipt['deployed']:
        if name not in receipt['original']:
            p = target / name
            assert p.resolve().is_relative_to(target.resolve())
            p.unlink()
    shutil.copytree(original_dir, target, dirs_exist_ok=True)
    assert inventory(target) == receipt['original']
    print('Restored and SHA256 verified:', target)
