import json
import os
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB limit

UPLOAD_FOLDER = '/tmp/sbom-uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


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

    fmt = detect_format(data)
    if fmt == 'cyclonedx':
        result = parse_cyclonedx(data)
    elif fmt == 'spdx':
        result = parse_spdx(data)
    else:
        return jsonify({'error': 'Unknown SBOM format. Supported: CycloneDX, SPDX'}), 400

    return jsonify(result)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
