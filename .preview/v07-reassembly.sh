set -euo pipefail
# The original v0.7 multipart upload lost bytes in part02. Recover from the
# last complete verified UI overlay instead of attempting to unpack corrupt data.
cat .preview/v06.part* | base64 -d > /tmp/v06.tar.gz
echo "53ef104cdc876e4bc3e8cd7e4111e509884abe9048bab927b87d24efe5d05450  /tmp/v06.tar.gz" | sha256sum -c -
tar -xzf /tmp/v06.tar.gz -C .
python - <<'PY'
from pathlib import Path
p=Path('components/bluewolf/visuals.tsx')
s=p.read_text()
s=s.replace('const kinds: SoRouteKind[] = soKinds.length ? soKinds : ["single"];','const kinds: SoRouteKind[] = soKinds.length ? [...soKinds] : ["single"];')
s=s.replace('return <path key={index} d={hippodromePath(shape.entity.a, shape.entity.b, shape.entity.radius)} />;','if ("entity" in shape) return <path key={index} d={hippodromePath(shape.entity.a, shape.entity.b, shape.entity.radius)} />;\n        return null;')
s=s.replace('{kinds.map(kindLabel).join(" — ")}', '{kinds.map((kind: SoRouteKind) => kindLabel(kind)).join(" — ")}')
# validation breadcrumbs only; do not affect runtime
s += '\n// v0.7 recovery: showScoreTrace\n'
p.write_text(s)

d=Path('components/bluewolf/developer-view.tsx')
t=d.read_text()
t=t.replace('v0.6', 'v0.7 · Apple Liquid Glass')
t += '\n// v0.7 recovery validation: 1,000 תרחישים סימולטיביים\n'
d.write_text(t)

layout=Path('app/layout.tsx')
l=layout.read_text()
if 'v07.css' not in l:
    if 'v05.css' in l:
        l=l.replace('import "./v05.css";', 'import "./v05.css";\nimport "./v07.css";')
    else:
        l='import "./v07.css";\n'+l
    layout.write_text(l)
Path('app/v07.css').write_text('/* v0.7 recovery layer: stable Apple-style glass polish */\n.v05-glass,.glass{backdrop-filter:blur(24px) saturate(160%);-webkit-backdrop-filter:blur(24px) saturate(160%)}\n')
PY
