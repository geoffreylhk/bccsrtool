"""Read source cells independently of the importer, using PDF table boundaries.

Run with the bundled Python runtime. An optional directory supplies fresh part1.pdf,
part2.pdf and part3.pdf downloads. Writes an audit CSV; never edits the dataset.
"""
import csv
import hashlib
import io
import json
import re
import sys
from pathlib import Path
import pdfplumber
from pypdf import PdfReader, PdfWriter

ROOT = Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / 'data.json').read_text())
LANDS = ['WLN', 'WLR', 'AL', 'PL', 'RLLD', 'RLHD', 'CL', 'IL']
LABELS = [('Intake', 'intake'), ('Groundwater used for drinking', 'drinking'),
          ('Toxicity', 'plants'), ('Livestock', 'livestock'), ('Major', 'microbial'),
          ('Groundwater flow', 'aquatic'), ('Groundwater used for livestock', 'watering'),
          ('Groundwater used for irrigation', 'irrigation')]

def compact(value):
    return re.sub(r'\s+', '', value or '').replace('μ', 'µ')

def grouped(words):
    groups = {}
    for word in words:
        y = next((y for y in groups if abs(y-word['top']) < 2), word['top'])
        groups.setdefault(y, []).append(word)
    return [(y, ' '.join(w['text'] for w in sorted(ws,key=lambda w:w['x0']))) for y,ws in sorted(groups.items())]

def open_pdf(part):
    path = Path(sys.argv[1]) / f'part{part}.pdf' if len(sys.argv)>1 else ROOT / f'verification/sources/schedule31-part{part}.pdf'
    raw = path.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == DATA['sources'][str(part)]['sha256'], f'Part {part}: source changed; re-audit required'
    if part==2:
        return pdfplumber.open(io.BytesIO(raw))
    writer=PdfWriter()
    for page in PdfReader(io.BytesIO(raw)).pages: writer.add_page(page.rotate(90))
    stream=io.BytesIO();writer.write(stream);stream.seek(0)
    return pdfplumber.open(stream)

checks=[]
with open_pdf(1) as pdf:
    source={};source_refs={};heading_refs={};matrix=None;factor=None
    for page in pdf.pages:
        text=page.extract_text() or ''
        heading=re.search(r'MATRIX\s+(\d+)',text)
        if heading:
            matrix=int(heading[1]);factor=None
            heading_refs[matrix]=set(re.findall(r'\d+', ' '.join(re.findall(r'STANDARDS([\d,]+)', text.split('COLUMN')[0]))))
        tables=page.find_tables()
        if not tables or not matrix: continue
        table=tables[0]
        if not any(len(row.cells)==10 and all(row.cells) for row in table.rows): continue
        first=next(row for row in table.rows if len(row.cells)==10 and all(row.cells))
        cols=first.cells
        words=page.extract_words()
        left=grouped([w for w in words if cols[0][0] <= (w['x0']+w['x1'])/2 < cols[0][2] and table.bbox[1] <= w['top'] < table.bbox[3]])
        anchors=[(y,key) for y,label in left for prefix,key in LABELS if label.startswith(prefix)]
        segments=([(table.bbox[1],factor)] if factor else [])+anchors
        for i,(start,key) in enumerate(segments):
            end=segments[i+1][0] if i+1<len(segments) else table.bbox[3]
            note_col=cols[9]
            source_refs.setdefault((matrix,key),set()).update(re.findall(r'\d+', ' '.join(w['text'] for w in words if note_col[0] < (w['x0']+w['x1'])/2 < note_col[2] and start-1 <= w['top'] < end-1)))
            for col,land in zip(cols[1:9],LANDS):
                selected=[w for w in words if col[0] < (w['x0']+w['x1'])/2 < col[2] and start-1 <= w['top'] < end-1]
                source.setdefault((matrix,key,land),[]).extend(line for _,line in grouped(selected))
        if anchors: factor=anchors[-1][1]
    assert set(heading_refs)=={r['matrix'] for c in DATA['contaminants'] for r in c['standards'] if r['part']==1}
    for contaminant in DATA['contaminants']:
        for record in contaminant['standards']:
            if record['part']!=1: continue
            expected_refs=source_refs.get((record['matrix'],record['factor']),set()) | heading_refs.get(record['matrix'],set())
            assert set(record.get('note_refs',[]))==expected_refs,(contaminant['name'],record['factor'],record.get('note_refs'),expected_refs)
            for land,cell in record['standards'].items():
                raw='\n'.join(source.get((record['matrix'],record['factor'],land),[]))
                checks.append([1,contaminant['name'],record['matrix'],record['factor'],land,cell['raw'],raw,compact(cell['raw'])==compact(raw)])

for part in [2,3]:
    with open_pdf(part) as pdf:
        page_tables={i+1:[(t,t.extract()) for t in page.find_tables()] for i,page in enumerate(pdf.pages)}
        official_rows={(compact(row[0]),compact(row[1])) for tables in page_tables.values() for table,rows in tables for row in rows
                       if len(row)==10 and row[0] and not row[0].startswith('COLUMN') and row[0]!='Substance'}
        stored_rows={(compact(r['source_name']),compact(c['cas'])) for c in DATA['contaminants'] for r in c['standards'] if r['part']==part}
        assert official_rows==stored_rows,('generic coverage',part,official_rows-stored_rows,stored_rows-official_rows)
        for contaminant in DATA['contaminants']:
            for record in contaminant['standards']:
                if record['part']!=part: continue
                page=pdf.pages[record['pages'][0]-1]
                page_number=record['pages'][0]
                if page_number not in page_tables: page_tables[page_number]=[(table,table.extract()) for table in page.find_tables()]
                for table,rows in page_tables[page_number]:
                    hit=next(((row,geometry) for row,geometry in zip(rows,table.rows) if len(row)==10 and compact(row[0])==compact(record['source_name']) and compact(row[1])==compact(contaminant['cas'])),None)
                    if not hit: continue
                    row,geometry=hit
                    header=next(r for r in table.rows if len(r.cells)==10 and all(r.cells))
                    top=next(c[1] for c in geometry.cells if c)
                    for index,land in enumerate(LANDS,2):
                        col=header.cells[index];center=(col[0]+col[2])/2
                        rect=next((c for c in geometry.cells if c and c[0]<=center<c[2] and c[1]==top),None)
                        raw=page.crop(rect).extract_text() if rect else ''
                        cell=record['standards'][land]
                        checks.append([part,contaminant['name'],'',record['source_name'],land,cell['raw'],raw,compact(cell['raw'])==compact(raw)])
                    break
                else: raise AssertionError(f'Source row not found: {part} {record["source_name"]}')
expected=sum(len(r['standards']) for c in DATA['contaminants'] for r in c['standards'])
assert len(checks)==expected,(len(checks),expected)
output=ROOT/'verification/schedule31-cell-recheck.csv'
with output.open('w') as stream:
    writer=csv.writer(stream);writer.writerow(['part','substance','matrix','factor_or_row','land_use','stored_raw','official_raw','matches']);writer.writerows(checks)
errors=[c for c in checks if not c[-1]]
print(f'{len(checks)} cells checked; {len(errors)} differences. {output}')
for row in errors[:15]:print(row)
sys.exit(bool(errors))
