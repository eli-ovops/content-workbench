#!/bin/bash
set -euo pipefail
config=/etc/nginx/sites-available/erp-trial
base=/srv/eli-sites/eli-social-publisher
release=20261010-icon-v5
expected=be779f1a3586aab69bad4476da7a231a23ccbe741bad408d028b10b24b3c3d01
test "$(sha256sum "$config" | cut -d' ' -f1)" = "$expected"
test "$(sha256sum "$base/releases/$release/icon-v5.png" | cut -d' ' -f1)" = 435c91d8e3c4faad3593e3fa28944b548d71b7e8de8b709904f40831646a2617
test ! -e "$base/public"
mkdir -p "$base/backups"
cp -p "$config" "$base/backups/nginx-before-$release.conf"
chmod 644 "$base/releases/$release/icon-v5.png"
ln -s "releases/$release" "$base/public"
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/nginx/sites-available/erp-trial')
s=p.read_text()
assert 'eli-social-publisher' not in s
assert s.rstrip().endswith('}')
block=''' location = /sites/eli-social-publisher/icon-v5.png {
  alias /srv/eli-sites/eli-social-publisher/public/icon-v5.png;
  add_header X-Content-Type-Options nosniff always;
 }
'''
pos=s.rfind('}')
candidate=p.with_name('erp-trial.icon-v5-candidate')
candidate.write_text(s[:pos]+block+s[pos:])
candidate.chmod(0o644)
candidate.replace(p)
PY
if ! nginx -t; then
 cp -p "$base/backups/nginx-before-$release.conf" "$config"
 exit 1
fi
systemctl reload nginx
sha256sum "$base/public/icon-v5.png" "$config"
systemctl is-active nginx erp-trial
