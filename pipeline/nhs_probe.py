"""Open the 2011 NHS DA table with pyivt and report how far it gets.

    python pipeline/download.py      # fetches and extracts pipeline/raw/NHSprofile_Can_PR_CD_CSD_DA.IVT
    python pipeline/nhs_probe.py [path]

Prints the table's metadata, the member labels pyivt finds (none, for this file), then
calls to_arrow(). With pyivt 0.0.5 the export stops before decoding any cell:

    ValueError: dimension 0, field _Sort: referenced member text is not a byte vector

The file itself is sound: Beyond 20/20 Browser opens it. See pipeline/README.md.
"""
import sys
from pathlib import Path

import pyivt

path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "raw" / "NHSprofile_Can_PR_CD_CSD_DA.IVT"
print(f"pyivt {pyivt.__version__}  {path} ({path.stat().st_size:,} bytes)")
t = pyivt.open(path)
m = t.metadata
print(f"title      {m.title.en}")
print(f"product    {m.product_id}   version {m.version}")
print(f"layout     counts {t.layout.counts} slugs {t.layout.slugs} geo_dim {t.layout.geo_dim}")
for i, d in enumerate(m.dimensions):
    en = d.members.en
    print(f"dimension {i}: {d.name.en!r} count {d.count} labels {'none' if en is None else len(en)}")
g = m.geographies
print("geographies:", {k: (None if getattr(g, k) is None else "present")
                       for k in ("member_id", "geo_uid", "geo_name", "geo_label", "dqf_code")})
print("to_arrow() ...")
try:
    tab = t.to_arrow()
except Exception as e:
    print(f"  {type(e).__name__}: {e}")
    sys.exit(1)
print(f"  {tab.num_rows:,} rows")
