"""Schedule 3.1 source lookup. Run python3 query.py; soil calculations share the JS engine."""
import json
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parent
data = json.loads((ROOT / 'data.json').read_text())
substances = data['contaminants']
by_name = {s['name']: s for s in substances}
LAND_USES = ['WLN', 'WLR', 'AL', 'PL', 'RLLD', 'RLHD', 'CL', 'IL']

def lookup(name, land_use, matrix='soil'):
    if matrix not in ('soil', 'both'):
        raise ValueError('Schedule 3.1 supports soil only.')
    rec = by_name.get(name)
    if not rec:
        print(f'{name}: not found')
        return
    print(f"{rec['name']} | CAS {rec['cas']} | {land_use}")
    for row in rec['standards']:
        cell = row['standards'].get(land_use, {})
        print(f"  Part {row['part']} {row['factor'] or 'generic'}: {cell.get('raw') or 'blank'} {row['unit']}")
        print(f"  {data['sources'][str(row['part'])]['url']} | pages {row['pages']}")
        if row['conditions'] or cell.get('kind') in ('conditional', 'blank'):
            print('  Source conditions: Review required')

def lookup_all_land_uses(name):
    for land_use in LAND_USES:
        lookup(name, land_use)

def find_by_cas(cas):
    for rec in substances:
        if rec['cas'] == cas:
            lookup_all_land_uses(rec['name'])

def list_substances():
    for index, rec in enumerate(substances, 1):
        print(index, rec['name'])

def find_exceedances(measured_values, land_use, matrix='soil', factors=None):
    if matrix != 'soil':
        raise ValueError('Water measurements are outside Schedule 3.1.')
    script = """
const fs = require('node:fs'), vm = require('node:vm');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const context = vm.createContext({ document: { addEventListener() {} } });
vm.runInContext(fs.readFileSync('data-utils.js', 'utf8'), context);
context.data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
context.input = input;
console.log(vm.runInContext(`JSON.stringify(Object.entries(input.values).map(([name, value]) => {
 const c = data.contaminants.find(c => c.name === name);
 return { name, result: c ? screenSoil(c, value, 'mg/kg', input.landUse, { factors: input.factors }) : null };
}))`, context));
"""
    result = subprocess.run(['node', '-e', script], cwd=ROOT,
        input=json.dumps(dict(values=measured_values, landUse=land_use, factors=factors or {})),
        text=True, capture_output=True, check=True)
    for row in json.loads(result.stdout):
        outcome = row['result']
        print(row['name'], outcome['status'] if outcome else 'Not found')

if __name__ == '__main__':
    lookup('Benzene', 'RLLD')
    lookup('antimony', 'RLLD')
    find_exceedances({'Anthracene': 3}, 'RLLD')
