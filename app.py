import json
import os
import tempfile
import uuid
from urllib.parse import urlparse

import requests
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB limit

UPLOAD_FOLDER = '/tmp/sbom-uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# URL fetch settings
MAX_URL_SIZE = 50 * 1024 * 1024  # 50MB
URL_TIMEOUT = 30  # seconds
ALLOWED_SCHEMES = {'http', 'https'}


def detect_format(data):
    """Detect SBOM format: CycloneDX or SPDX."""
    if 'bomFormat' in data and data['bomFormat'] == 'CycloneDX':
        return 'cyclonedx'
    if 'spdxVersion' in data:
        return 'spdx'
    if 'components' in data and isinstance(data['components'], list):
        return 'cyclonedx'
    if 'packages' in data and isinstance(data['packages'], list):
        return 'spdx'
    return 'unknown'


def parse_cyclonedx(data):
    """Parse CycloneDX SBOM JSON."""
    components = []
    for comp in data.get('components', []):
        licenses = []
        for lic in comp.get('licenses', []):
            if 'license' in lic:
                l = lic['license']
                licenses.append(l.get('id', l.get('name', 'Unknown')))
            elif 'expression' in lic:
                licenses.append(lic['expression'])

        ext_refs = []
        for ref in comp.get('externalReferences', []):
            ext_refs.append({'type': ref.get('type', ''), 'url': ref.get('url', '')})

        components.append({
            'name': comp.get('name', 'Unknown'),
            'version': comp.get('version', 'N/A'),
            'type': comp.get('type', 'library'),
            'purl': comp.get('purl', ''),
            'group': comp.get('group', ''),
            'description': comp.get('description', ''),
            'licenses': licenses,
            'externalReferences': ext_refs,
            'bom_ref': comp.get('bom-ref', ''),
        })

    dependencies = []
    for dep in data.get('dependencies', []):
        ref = dep.get('ref', '')
        depends_on = dep.get('dependsOn', [])
        dependencies.append({'ref': ref, 'dependsOn': depends_on})

    metadata = {}
    if 'metadata' in data:
        m = data['metadata']
        if 'component' in m:
            mc = m['component']
            metadata['rootComponent'] = mc.get('name', '')
            metadata['rootVersion'] = mc.get('version', '')
            metadata['rootType'] = mc.get('type', '')
            metadata['rootBomRef'] = mc.get('bom-ref', '')
        if 'timestamp' in m:
            metadata['timestamp'] = m['timestamp']
        if 'tools' in m:
            tools = m['tools']
            if isinstance(tools, list):
                metadata['tools'] = [t.get('name', str(t)) for t in tools]
            elif isinstance(tools, dict) and 'components' in tools:
                metadata['tools'] = [t.get('name', str(t)) for t in tools['components']]

    return {
        'format': 'CycloneDX',
        'specVersion': data.get('specVersion', 'N/A'),
        'serialNumber': data.get('serialNumber', ''),
        'metadata': metadata,
        'components': components,
        'dependencies': dependencies,
        'totalComponents': len(components),
    }


def parse_spdx(data):
    """Parse SPDX SBOM JSON."""
    components = []
    pkg_id_map = {}

    for pkg in data.get('packages', []):
        spdx_id = pkg.get('SPDXID', '')
        name = pkg.get('name', 'Unknown')
        version = pkg.get('versionInfo', 'N/A')

        licenses = []
        if pkg.get('licenseConcluded') and pkg['licenseConcluded'] != 'NOASSERTION':
            licenses.append(pkg['licenseConcluded'])
        elif pkg.get('licenseDeclared') and pkg['licenseDeclared'] != 'NOASSERTION':
            licenses.append(pkg['licenseDeclared'])

        ext_refs = []
        for ref in pkg.get('externalRefs', []):
            ext_refs.append({
                'type': ref.get('referenceType', ''),
                'url': ref.get('referenceLocator', ''),
            })

        purl = ''
        for ref in pkg.get('externalRefs', []):
            if ref.get('referenceType') == 'purl':
                purl = ref.get('referenceLocator', '')
                break

        comp = {
            'name': name,
            'version': version,
            'type': 'package',
            'purl': purl,
            'group': '',
            'description': pkg.get('description', pkg.get('summary', '')),
            'licenses': licenses,
            'externalReferences': ext_refs,
            'bom_ref': spdx_id,
        }
        components.append(comp)
        pkg_id_map[spdx_id] = name

    dependencies = []
    dep_map = {}
    for rel in data.get('relationships', []):
        rel_type = rel.get('relationshipType', '')
        if rel_type == 'DEPENDS_ON':
            parent = rel.get('spdxElementId', '')
            child = rel.get('relatedSpdxElement', '')
            if parent not in dep_map:
                dep_map[parent] = []
            dep_map[parent].append(child)
        elif rel_type == 'DEPENDENCY_OF':
            parent = rel.get('relatedSpdxElement', '')
            child = rel.get('spdxElementId', '')
            if parent not in dep_map:
                dep_map[parent] = []
            dep_map[parent].append(child)

    for ref, depends_on in dep_map.items():
        dependencies.append({'ref': ref, 'dependsOn': depends_on})

    metadata = {
        'documentName': data.get('name', ''),
        'documentNamespace': data.get('documentNamespace', ''),
    }
    if 'creationInfo' in data:
        ci = data['creationInfo']
        metadata['created'] = ci.get('created', '')
        metadata['creators'] = ci.get('creators', [])

    return {
        'format': 'SPDX',
        'specVersion': data.get('spdxVersion', 'N/A'),
        'serialNumber': data.get('documentNamespace', ''),
        'metadata': metadata,
        'components': components,
        'dependencies': dependencies,
        'totalComponents': len(components),
    }


def validate_sbom_structure(data):
    """Validate that the JSON has a recognizable SBOM structure.

    Returns (format_name, error_message). If valid, error_message is None.
    """
    if not isinstance(data, dict):
        return None, 'JSONのルートがオブジェクトではありません。'

    fmt = detect_format(data)
    if fmt == 'unknown':
        return None, 'SBOMフォーマットを認識できません（CycloneDX / SPDX のみ対応）。'

    # CycloneDX: components list must exist
    if fmt == 'cyclonedx':
        comps = data.get('components', [])
        if not isinstance(comps, list):
            return None, 'CycloneDX: components が配列ではありません。'

    # SPDX: packages list must exist
    if fmt == 'spdx':
        pkgs = data.get('packages', [])
        if not isinstance(pkgs, list):
            return None, 'SPDX: packages が配列ではありません。'

    return fmt, None


def validate_url(url_str):
    """Basic URL validation. Returns (parsed_url, error_message)."""
    if not url_str or not url_str.strip():
        return None, 'URLが空です。'

    url_str = url_str.strip()
    try:
        parsed = urlparse(url_str)
    except Exception:
        return None, 'URLの形式が不正です。'

    if parsed.scheme not in ALLOWED_SCHEMES:
        return None, f'スキームは http または https のみ対応しています（入力: {parsed.scheme}）。'

    if not parsed.netloc:
        return None, 'URLにホスト名がありません。'

    return parsed, None


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/parse', methods=['POST'])
def parse_sbom():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    try:
        content = file.read().decode('utf-8')
        data = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        return jsonify({'error': f'Invalid JSON file: {str(e)}'}), 400

    fmt, err = validate_sbom_structure(data)
    if err:
        return jsonify({'error': err}), 400

    if fmt == 'cyclonedx':
        result = parse_cyclonedx(data)
    elif fmt == 'spdx':
        result = parse_spdx(data)
    else:
        return jsonify({'error': 'Unknown SBOM format. Supported: CycloneDX, SPDX'}), 400

    return jsonify(result)


@app.route('/api/fetch-url', methods=['POST'])
def fetch_url():
    """Fetch a JSON SBOM from a remote URL, validate, parse, then delete the temp file."""
    body = request.get_json(silent=True) or {}
    url_str = body.get('url', '')

    # --- URL validation ---
    parsed, err = validate_url(url_str)
    if err:
        return jsonify({'error': err}), 400

    # --- Download to temp file ---
    tmp_path = None
    try:
        resp = requests.get(
            url_str,
            timeout=URL_TIMEOUT,
            stream=True,
            headers={'Accept': 'application/json'},
            allow_redirects=True,
        )
        resp.raise_for_status()

        # Check content-length if provided
        cl = resp.headers.get('Content-Length')
        if cl and int(cl) > MAX_URL_SIZE:
            return jsonify({'error': f'ファイルサイズが大きすぎます（上限 {MAX_URL_SIZE // (1024*1024)}MB）。'}), 400

        # Stream to temp file with size guard
        tmp_fd, tmp_path = tempfile.mkstemp(suffix='.json', dir=UPLOAD_FOLDER)
        downloaded = 0
        with os.fdopen(tmp_fd, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=65536):
                downloaded += len(chunk)
                if downloaded > MAX_URL_SIZE:
                    raise ValueError('ファイルサイズが上限を超えました。')
                f.write(chunk)

        # --- Parse JSON ---
        with open(tmp_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # --- Validate SBOM structure ---
        fmt, err = validate_sbom_structure(data)
        if err:
            return jsonify({'error': f'取得したファイルはSBOMとして認識できません: {err}'}), 400

        # --- Parse into our format ---
        if fmt == 'cyclonedx':
            result = parse_cyclonedx(data)
        else:
            result = parse_spdx(data)

        return jsonify(result)

    except requests.exceptions.Timeout:
        return jsonify({'error': f'URLへの接続がタイムアウトしました（{URL_TIMEOUT}秒）。'}), 400
    except requests.exceptions.ConnectionError:
        return jsonify({'error': 'URLに接続できませんでした。ネットワークまたはURLを確認してください。'}), 400
    except requests.exceptions.HTTPError as e:
        return jsonify({'error': f'HTTPエラー: {e.response.status_code}'}), 400
    except json.JSONDecodeError:
        return jsonify({'error': '取得したファイルは有効なJSONではありません。'}), 400
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'取得中にエラーが発生しました: {str(e)}'}), 500
    finally:
        # Always clean up the temp file
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
