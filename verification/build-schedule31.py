"""Rebuild source records using installed pdfplumber/pypdf; run from repository root.

Complex cells retain their source text and are deliberately unresolved, never guessed.
"""
import hashlib
import io
import json
import re
from pathlib import Path

import pdfplumber
from pypdf import PdfReader, PdfWriter

ROOT = Path(__file__).resolve().parent.parent
LANDS = ['WLN', 'WLR', 'AL', 'PL', 'RLLD', 'RLHD', 'CL', 'IL']
FACTORS = ['intake', 'drinking', 'plants', 'livestock', 'microbial', 'aquatic', 'watering', 'irrigation']
data = json.loads((ROOT / 'data.json').read_text())
data['contaminants'] = data['contaminants'][:40]
sources = {}


def source(part):
    path = ROOT / f'verification/sources/schedule31-part{part}.pdf'
    raw = path.read_bytes()
    sources[str(part)] = dict(url='https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/' +
        ('159_2025' if part == 2 else '133_2022') + f'_Sch%203.1-part{part}',
        sha256=hashlib.sha256(raw).hexdigest(), retrieved='2026-10-15',
        version='B.C. Reg. 159/2025' if part == 2 else 'B.C. Reg. 133/2022',
        consolidation_current_to='2026-10-06')
    if part == 2:
        return pdfplumber.open(io.BytesIO(raw))
    writer = PdfWriter()
    for page in PdfReader(io.BytesIO(raw)).pages:
        writer.add_page(page.rotate(90))
    stream = io.BytesIO()
    writer.write(stream)
    stream.seek(0)
    return pdfplumber.open(stream)


def cell(raw):
    cleaned = raw.replace(' ', '').replace('\n', '')
    if '%' in raw or 'mg/g' in cleaned:
        return dict(kind='conditional', raw=raw, value=None, unit='%' if '%' in raw else 'mg/g')
    if raw.strip() == 'NS':
        return dict(kind='ns', raw=raw, value=None)
    if re.fullmatch(r'\d+(?:\.\d+)?', cleaned):
        return dict(kind='numeric', raw=raw, value=float(cleaned))
    return dict(kind='conditional' if raw else 'blank', raw=raw, value=None)


def lines(words):
    grouped = {}
    for w in words:
        key = next((y for y in grouped if abs(y-w['top']) < 2), w['top'])
        grouped.setdefault(key, []).append(w)
    return [(y, ' '.join(w['text'] for w in sorted(ws, key=lambda w: w['x0'])))
            for y, ws in sorted(grouped.items())]


with source(1) as pdf:
    sources['1']['page_text'] = {str(i+1): page.extract_text() for i,page in enumerate(pdf.pages)}
    matrices = {}
    current = None
    for number, page in enumerate(pdf.pages, 1):
        text = page.extract_text() or ''
        match = re.search(r'MATRIX\s+(\d+)', text)
        if match:
            current = int(match.group(1))
        if current:
            matrices.setdefault(current, []).append((number, page, text))
    assert len(matrices) == 40
    for contaminant in data['contaminants'][:40]:
        hits = [(n, ps) for n, ps in matrices.items() if
            (contaminant['cas'] not in ('NS', 'NA') and contaminant['cas'] in ps[0][2].split('COLUMN')[0]) or
            (contaminant['id'] == 'ddt' and '[DDT]' in ps[0][2].split('COLUMN')[0]) or
            (contaminant['id'] == 'nonylphenol' and 'NONYLPHENOL' in ps[0][2].split('COLUMN')[0])]
        assert len(hits) == 1, contaminant['id']
        matrix, pages = hits[0]
        raw = {factor: {land: [] for land in LANDS} for factor in FACTORS}
        labels = {factor: [] for factor in FACTORS}
        factor_pages = {factor: [] for factor in FACTORS}
        note_refs = {factor: set() for factor in FACTORS}
        words = pages[0][1].extract_words()
        centers = [(w['x0']+w['x1'])/2 for land in LANDS for w in words if w['text'] == f'({land})']
        assert len(centers) == 8
        factor = None
        notes = []
        for number, page, text in pages:
            words = page.extract_words()
            left = lines([w for w in words if w['x0'] < 100])
            anchors = []
            for y, label in left:
                if label.startswith('Intake'): f = 'intake'
                elif label.startswith('Toxicity'): f = 'plants'
                elif label.startswith('Livestock'): f = 'livestock'
                elif label.startswith('Major'): f = 'microbial'
                elif label.startswith('Groundwater'):
                    context = ' '.join(w['text'] for w in words if w['x0'] < centers[0]-35 and y-2 <= w['top'] < y+23)
                    f = next((key for keyword, key in [('drinking','drinking'), ('surface','aquatic'), ('livestock','watering'), ('irrigation','irrigation')] if keyword in context), None)
                    assert f, (contaminant['id'], context)
                else: continue
                anchors.append((y, f))
            if not anchors and not any(label.startswith('pH') for _, label in left): continue
            note_y = next((y for y,label in left if label == 'Notes'), page.height-30)
            main_tables = page.find_tables()
            table_end = main_tables[0].bbox[3] if main_tables else page.height-30
            if anchors and note_y < anchors[0][0]: note_y = table_end
            note_y = min(note_y, table_end)
            if 'Notes' in text and matrix != 1: notes.append(text.split('Notes', 1)[1].split('COLUMN', 1)[0])
            segments = ([(-1, factor)] if factor else []) + anchors
            for idx, (y, f) in enumerate(segments):
                if not f: continue
                end = min(segments[idx+1][0] if idx+1 < len(segments) else note_y, note_y)
                factor_pages[f].append(number)
                note_words = [w['text'] for w in words if w['x0'] > centers[-1]+30 and y-2 <= w['top'] < end-2]
                note_refs[f].update(re.findall(r'\d+', ' '.join(note_words)))
                labels[f].extend(label for top,label in lines([w for w in words if w['x0'] < centers[0]-35]) if y-2 <= top < end-2)
                for j,land in enumerate(LANDS):
                    lo = (centers[j-1]+centers[j])/2 if j else centers[0]-30
                    hi = (centers[j]+centers[j+1])/2 if j < 7 else centers[-1]+30
                    ws = [w for w in words if lo < (w['x0']+w['x1'])/2 < hi and y-2 <= w['top'] < end-2]
                    raw[f][land].extend(text for _,text in lines(ws))
            if anchors: factor = anchors[-1][1]
        notes_text = '\n'.join(notes)
        note_starts = list(re.finditer(r'(?m)^[ \t]*(\d+)[ \t]+', notes_text))
        source_notes = {m.group(1): notes_text[m.end():note_starts[i+1].start() if i+1 < len(note_starts) else len(notes_text)].strip()
                        for i,m in enumerate(note_starts)}
        heading_refs = set(re.findall(r'\d+', ' '.join(re.findall(r'STANDARDS([\d,]+)', pages[0][2].split('COLUMN')[0]))))
        records = []
        for f in FACTORS:
            values = {land: cell('\n'.join(raw[f][land])) for land in LANDS}
            # Multiple lines are conditional bands/species, never one concatenated number.
            for value in values.values():
                if '\n' in value['raw']:
                    value.update(kind='conditional', value=None)
            records.append(dict(part=1, factor=f, matrix=matrix, pages=sorted(set(factor_pages[f])),
                unit='µg/g', standards=values,
                # Definitions of pH do not make unrelated intake/ecological rows conditional.
                conditions=[source_notes[ref] for ref in sorted(note_refs[f] | heading_refs)
                            if ref in source_notes and not source_notes[ref].startswith('The pH is the pH')],
                note_refs=sorted(note_refs[f] | heading_refs), source_notes=source_notes, source_labels=labels[f]))
        contaminant['standards'] = records
        if contaminant['cas'] == 'NS': contaminant['cas'] = 'NA'
        if contaminant['id'] == 'pcdds_pcdfs': contaminant['name'] = 'PCDDs/PCDFs (TCDD toxicity equivalents)'

# Generic tables use cell geometry to preserve actual shared-cell values.
generic = {}
for part in (2, 3):
    with source(part) as pdf:
        sources[str(part)]['page_text'] = {str(i+1): page.extract_text() for i,page in enumerate(pdf.pages)}
        all_notes = (pdf.pages[-1].extract_text() or '').split('Notes', 1)[-1]
        for number, page in enumerate(pdf.pages, 1):
            for table in page.find_tables():
                rows = table.extract()
                for row, geometry in zip(rows, table.rows):
                    if len(row) != 10 or row[0] in (None, 'COLUMN 1', 'Substance'): continue
                    name = ' '.join(row[0].split())
                    cas = ' '.join((row[1] or '').split())
                    base_name = re.sub(r'\d+$', '', name)
                    key = cas if cas != 'NA' else base_name
                    record = generic.setdefault(key, dict(name=base_name, cas=cas, standards=[]))
                    values = {}
                    for j, land in enumerate(LANDS, 2):
                        text = row[j]
                        if text is None:
                            x = table.rows[1].cells[j][0] + 2
                            y = next(c[1] for c in geometry.cells if c)
                            shared = next((k for k,c in enumerate(geometry.cells) if c and c[0] <= x < c[2] and c[1] == y), None)
                            text = row[shared] if shared is not None else ''
                        values[land] = cell(' '.join((text or '').split()))
                    special = bool(re.search(r'\d$', name)) or name in ('sulfur, elemental','thallium')
                    record['standards'].append(dict(part=part, factor=None, pages=[number], source_name=name, unit='µg/g',
                        standards=values, conditions=[all_notes] if special else []))
assert len(generic) == 528
for index, record in enumerate(generic.values()):
    assert 1 <= len(record['standards']) <= 2, record['name']
    data['contaminants'].append(dict(id=f'generic_{index+1}', category='Generic Soil Standards (Parts 2–3)',
        description='Schedule 3.1 generic soil standards; source-specific conditions apply.',
        **record))
data['sources'] = sources
data['metadata'].update(last_amended='Source cells rechecked 2026-10-15; consolidation 2026-10-06',
    gw_unit=None, notes={'NS':'No numerical standard; not zero', 'blank':'Blank source cell; unresolved',
    'conditional':'Requires source conditions or professional review'})
for contaminant in data['contaminants']:
    contaminant.pop('thresholds', None)
data['contaminantCategories']['Generic Soil Standards (Parts 2–3)'] = dict(description='Generic human and ecological soil standards', relevantLandUse=LANDS)
(ROOT / 'data.json').write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
print('Built', len(data['contaminants']), 'substances with source records for all three parts.')
