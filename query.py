"""
BC CSR Schedule 3.1 — Human Health Protection Standards
Query script for VS Code

HOW TO RUN:
  1. Put this file in the same folder as data.json
  2. Open terminal in VS Code  (Terminal → New Terminal)
  3. Run:  python3 query.py
"""

import json

# ── Load the file ─────────────────────────────────────────────────────────────
with open("data.json", encoding="utf-8") as f:
    data = json.load(f)

substances = data["substances"]
by_name = {s["substance"]: s for s in substances}
LAND_USES = ["WLN", "WLR", "AL", "PL", "RLLD", "RLHD", "CL", "IL"]


def lookup(substance_name, land_use, matrix="both"):
    rec = by_name.get(substance_name)
    if not rec:
        print(f"  '{substance_name}' not found. Run list_substances() to see all names.")
        return
    soil = rec["soil_ug_per_g"].get(land_use, "N/A")
    gw   = rec["gw_drinking_ug_per_L"].get(land_use, "N/A")
    print(f"\n{'─'*55}")
    print(f"  Substance : {rec['substance']}  (Matrix {rec['matrix']})")
    print(f"  CAS       : {rec['cas_number']}")
    print(f"  Land Use  : {land_use}  ({data['metadata']['land_use_codes'][land_use]})")
    print(f"{'─'*55}")
    if matrix in ("soil", "both"):
        print(f"  Soil intake standard : {soil} ug/g")
    if matrix in ("gw", "both"):
        print(f"  GW drinking standard : {gw} ug/L")
    print(f"{'─'*55}\n")


def lookup_all_land_uses(substance_name):
    rec = by_name.get(substance_name)
    if not rec:
        print(f"  '{substance_name}' not found.")
        return
    print(f"\n{'─'*70}")
    print(f"  {rec['substance']}  (Matrix {rec['matrix']}, CAS: {rec['cas_number']})")
    print(f"{'─'*70}")
    print(f"  {'Land Use':<30} {'Soil (ug/g)':>18} {'GW Drinking (ug/L)':>20}")
    print(f"  {'─'*28} {'─'*18} {'─'*20}")
    for lu in LAND_USES:
        lu_full = data["metadata"]["land_use_codes"][lu]
        soil = rec["soil_ug_per_g"][lu]
        gw   = rec["gw_drinking_ug_per_L"][lu]
        print(f"  {lu_full:<30} {soil:>18} {gw:>20}")
    print(f"{'─'*70}\n")


def compare_substances(substance_list, land_use, matrix="both"):
    print(f"\n{'─'*75}")
    print(f"  Comparison — Land Use: {land_use} ({data['metadata']['land_use_codes'][land_use]})")
    print(f"{'─'*75}")
    if matrix in ("soil", "both"):
        print(f"  {'Substance':<45} {'CAS':>12} {'Soil (ug/g)':>15}")
        print(f"  {'─'*43} {'─'*12} {'─'*15}")
        for name in substance_list:
            rec = by_name.get(name)
            if rec:
                print(f"  {rec['substance']:<45} {rec['cas_number']:>12} {rec['soil_ug_per_g'][land_use]:>15}")
        print()
    if matrix in ("gw", "both"):
        print(f"  {'Substance':<45} {'CAS':>12} {'GW Drinking (ug/L)':>20}")
        print(f"  {'─'*43} {'─'*12} {'─'*20}")
        for name in substance_list:
            rec = by_name.get(name)
            if rec:
                print(f"  {rec['substance']:<45} {rec['cas_number']:>12} {rec['gw_drinking_ug_per_L'][land_use]:>20}")
    print(f"{'─'*75}\n")


def find_by_cas(cas_number):
    results = [s for s in substances if s["cas_number"] == cas_number]
    if not results:
        print(f"  CAS '{cas_number}' not found.")
        return
    for rec in results:
        lookup_all_land_uses(rec["substance"])


def list_substances():
    print(f"\n{'─'*55}")
    print(f"  {'#':>3}  Substance")
    print(f"  {'─'*3}  {'─'*48}")
    for s in substances:
        print(f"  {s['matrix']:>3}  {s['substance']}")
    print(f"{'─'*55}\n")


def find_exceedances(measured_values, land_use, matrix="soil"):
    field = "soil_ug_per_g" if matrix == "soil" else "gw_drinking_ug_per_L"
    units = "ug/g" if matrix == "soil" else "ug/L"
    print(f"\n{'─'*70}")
    print(f"  Exceedance Check — Land Use: {land_use} | Matrix: {matrix.upper()}")
    print(f"{'─'*70}")
    print(f"  {'Substance':<35} {'Measured':>10} {'Standard':>15} {'Status':>12}")
    print(f"  {'─'*33} {'─'*10} {'─'*15} {'─'*12}")
    for name, measured in measured_values.items():
        rec = by_name.get(name)
        if not rec:
            print(f"  {name:<35} {'NOT FOUND':>38}")
            continue
        std_str = rec[field][land_use]
        if std_str in ("NS", "pH-dep.", "> 1 000 mg/g"):
            print(f"  {name:<35} {measured:>10.3g} {std_str:>15}   Special value")
            continue
        try:
            std_val = float(std_str.replace(" ", ""))
            exceeds = measured > std_val
            status  = "EXCEEDS" if exceeds else "OK"
            print(f"  {name:<35} {measured:>10.3g} {std_val:>15.3g} {units}  {status}")
        except ValueError:
            print(f"  {name:<35} {measured:>10.3g} {std_str:>15}  (parse error)")
    print(f"{'─'*70}\n")


# ── YOUR QUERIES GO HERE ──────────────────────────────────────────────────────

if __name__ == "__main__":

    # 1. Single substance + land use
    lookup("Arsenic", "RLLD")

    # 2. All land uses for one substance
    lookup_all_land_uses("Benzene")

    # 3. Compare metals side by side
    compare_substances(
        ["Arsenic", "Lead", "Cadmium", "Copper", "Mercury", "Nickel", "Zinc"],
        land_use="RLLD",
        matrix="soil"
    )

    # 4. Look up by CAS number
    find_by_cas("79-01-6")

    # 5. Exceedance check — replace with your site measurements
    find_exceedances(
        measured_values={
            "Arsenic":     55,
            "Beryllium":    200,
            "Lead":        80,
            "Naphthalene": 600,
        },
        land_use="RLHD",
        matrix="gw"
    )

    # 6. List all 40 substances
    list_substances()