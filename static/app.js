// State
let sbomData = null;
let sortCol = 'name';
let sortDir = 'asc';

// DOM elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileSelectBtn = document.getElementById('file-select-btn');
const loading = document.getElementById('loading');
const errorMsg = document.getElementById('error-msg');
const results = document.getElementById('results');
const summaryContent = document.getElementById('summary-content');
const tableBody = document.getElementById('table-body');
const searchInput = document.getElementById('search-input');
const typeFilter = document.getElementById('type-filter');
const componentCount = document.getElementById('component-count');

// File Upload — only the button triggers the file dialog
fileSelectBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
});

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) uploadFile(file);
    fileInput.value = '';
});

async function uploadFile(file) {
    if (!file.name.endsWith('.json')) {
        showError('JSONファイルを選択してください。');
        return;
    }

    loading.classList.remove('hidden');
    errorMsg.classList.add('hidden');
    results.classList.add('hidden');

    const formData = new FormData();
    formData.append('file', file);

    try {
        const resp = await fetch('/api/parse', { method: 'POST', body: formData });
        const data = await resp.json();

        if (!resp.ok) {
            showError(data.error || 'エラーが発生しました。');
            return;
        }

        sbomData = data;
        renderResults();
    } catch (err) {
        showError('ファイルの解析中にエラーが発生しました: ' + err.message);
    } finally {
        loading.classList.add('hidden');
    }
}

function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.remove('hidden');
    loading.classList.add('hidden');
}

// Back to home
document.getElementById('back-btn').addEventListener('click', () => {
    results.classList.add('hidden');
    errorMsg.classList.add('hidden');
    document.getElementById('upload-section').style.display = '';
    sbomData = null;
    d3.selectAll('.tree-tooltip').remove();
    document.getElementById('tree-container').innerHTML = '';
});

// Render
function renderResults() {
    results.classList.remove('hidden');
    document.getElementById('upload-section').style.display = 'none';
    renderSummary();
    populateTypeFilter();
    renderTable();
    renderTree();
}

function renderSummary() {
    const items = [
        { label: 'フォーマット', value: sbomData.format },
        { label: 'バージョン', value: sbomData.specVersion },
        { label: 'コンポーネント数', value: sbomData.totalComponents },
        { label: '依存関係', value: sbomData.dependencies.length > 0 ? `${sbomData.dependencies.length} エントリ` : 'なし' },
    ];

    const meta = sbomData.metadata;
    if (meta.rootComponent) items.push({ label: 'ルートコンポーネント', value: `${meta.rootComponent} ${meta.rootVersion || ''}` });
    if (meta.timestamp) items.push({ label: 'タイムスタンプ', value: meta.timestamp });
    if (meta.documentName) items.push({ label: 'ドキュメント名', value: meta.documentName });
    if (meta.created) items.push({ label: '作成日', value: meta.created });

    summaryContent.innerHTML = items.map(i => `
        <div class="summary-item">
            <div class="label">${i.label}</div>
            <div class="value">${i.value}</div>
        </div>
    `).join('');
}

function populateTypeFilter() {
    const types = [...new Set(sbomData.components.map(c => c.type))].sort();
    typeFilter.innerHTML = '<option value="">すべてのタイプ</option>' +
        types.map(t => `<option value="${t}">${t}</option>`).join('');
}

// Table
function getFilteredComponents() {
    let comps = sbomData.components;
    const query = searchInput.value.toLowerCase();
    const typeVal = typeFilter.value;

    if (query) {
        comps = comps.filter(c =>
            c.name.toLowerCase().includes(query) ||
            c.version.toLowerCase().includes(query) ||
            c.group.toLowerCase().includes(query) ||
            c.purl.toLowerCase().includes(query)
        );
    }
    if (typeVal) {
        comps = comps.filter(c => c.type === typeVal);
    }

    comps.sort((a, b) => {
        const va = (a[sortCol] || '').toLowerCase();
        const vb = (b[sortCol] || '').toLowerCase();
        const cmp = va.localeCompare(vb);
        return sortDir === 'asc' ? cmp : -cmp;
    });

    return comps;
}

function renderTable() {
    const comps = getFilteredComponents();
    componentCount.textContent = `${comps.length} / ${sbomData.totalComponents} 件`;

    tableBody.innerHTML = comps.map(c => {
        const licenses = c.licenses.length > 0
            ? c.licenses.map(l => `<span class="badge badge-license">${escapeHtml(l)}</span>`).join(' ')
            : '<span style="color:var(--text-muted)">—</span>';
        return `<tr>
            <td><strong>${escapeHtml(c.name)}</strong></td>
            <td>${escapeHtml(c.version)}</td>
            <td><span class="badge badge-type">${escapeHtml(c.type)}</span></td>
            <td>${licenses}</td>
            <td>${escapeHtml(c.group)}</td>
            <td class="purl-cell">${escapeHtml(c.purl)}</td>
        </tr>`;
    }).join('');
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Sort
document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (sortCol === col) {
            sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            sortCol = col;
            sortDir = 'asc';
        }
        document.querySelectorAll('th.sortable').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
        th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
        renderTable();
    });
});

searchInput.addEventListener('input', renderTable);
typeFilter.addEventListener('change', renderTable);

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
    });
});

// ============================================================
// Force-Directed Graph (Obsidian-like dependency visualization)
// ============================================================
function renderTree() {
    const container = document.getElementById('tree-container');
    const noDepsMsg = document.getElementById('no-deps-msg');
    const restoreBtn = document.getElementById('restore-nodes');
    container.innerHTML = '';
    restoreBtn.classList.add('hidden');

    // Remove any old tooltip
    d3.selectAll('.tree-tooltip').remove();

    if (!sbomData.dependencies || sbomData.dependencies.length === 0) {
        noDepsMsg.classList.remove('hidden');
        container.style.display = 'none';
        return;
    }

    noDepsMsg.classList.add('hidden');
    container.style.display = 'block';

    // Build name lookup map
    const nameMap = {};
    sbomData.components.forEach(c => {
        nameMap[c.bom_ref] = c;
    });

    // Build adjacency (parent -> children)
    const childrenMap = {};
    const parentMap = {};   // child -> [parents]
    sbomData.dependencies.forEach(dep => {
        childrenMap[dep.ref] = dep.dependsOn || [];
        (dep.dependsOn || []).forEach(child => {
            if (!parentMap[child]) parentMap[child] = [];
            parentMap[child].push(dep.ref);
        });
    });

    // Count all descendants recursively
    const descendantCache = {};
    function countDescendants(ref, visited) {
        if (descendantCache[ref] !== undefined) return descendantCache[ref];
        if (!visited) visited = new Set();
        if (visited.has(ref)) return 0;
        visited.add(ref);
        const children = childrenMap[ref] || [];
        let total = children.length;
        for (const child of children) {
            total += countDescendants(child, new Set(visited));
        }
        descendantCache[ref] = total;
        return total;
    }

    // Collect unique node refs from dependencies
    const nodeRefSet = new Set();
    sbomData.dependencies.forEach(dep => {
        nodeRefSet.add(dep.ref);
        (dep.dependsOn || []).forEach(d => nodeRefSet.add(d));
    });

    // Build ALL nodes data (master list, never changes)
    const allNodesData = [];
    nodeRefSet.forEach(ref => {
        const comp = nameMap[ref];
        const directChildren = (childrenMap[ref] || []).length;
        const totalDescendants = countDescendants(ref);
        const parents = parentMap[ref] || [];
        allNodesData.push({
            id: ref,
            comp: comp,
            name: comp ? comp.name : ref,
            version: comp ? comp.version : '',
            label: comp ? `${comp.name}@${comp.version}` : ref,
            directChildren: directChildren,
            totalDescendants: totalDescendants,
            parentRefs: parents,
            isRoot: parents.length === 0,
        });
    });

    // Build ALL links data (master list)
    const allLinksData = [];
    sbomData.dependencies.forEach(dep => {
        (dep.dependsOn || []).forEach(child => {
            if (nodeRefSet.has(dep.ref) && nodeRefSet.has(child)) {
                allLinksData.push({ source: dep.ref, target: child });
            }
        });
    });

    // --- Collapse state ---
    const hiddenNodes = new Set();   // set of node ids that are hidden
    const collapsedBy = new Map();   // nodeId -> Set of collapser node ids that caused it to hide

    // Get all descendants of a node recursively
    function getAllDescendants(ref, visited) {
        if (!visited) visited = new Set();
        if (visited.has(ref)) return visited;
        visited.add(ref);
        const children = childrenMap[ref] || [];
        for (const child of children) {
            getAllDescendants(child, visited);
        }
        return visited;
    }

    // Collapse: hide descendants of clickedId, but keep those with
    // a visible parent that is NOT itself being hidden in this operation.
    // Uses iterative fixed-point: start with all descendants as candidates,
    // then remove any candidate that has a parent which is visible and not a candidate.
    // Repeat until stable — this correctly handles chains like A->B->C where
    // B is also a parent of C but is itself being hidden.
    function collapseNode(clickedId) {
        const descendants = getAllDescendants(clickedId, new Set());
        descendants.delete(clickedId); // don't hide the clicked node itself

        if (descendants.size === 0) return;

        // All descendants start as candidates for hiding
        const candidates = new Set(descendants);

        // Iteratively remove candidates that have a visible parent outside the candidate set
        let changed = true;
        while (changed) {
            changed = false;
            for (const nodeId of candidates) {
                const parents = parentMap[nodeId] || [];
                let hasExternalVisibleParent = false;
                for (const p of parents) {
                    if (p === clickedId) continue;          // the collapsed node itself — skip
                    if (hiddenNodes.has(p)) continue;       // already hidden from a prior collapse
                    if (candidates.has(p)) continue;        // also being hidden in this operation
                    // p is visible and NOT being hidden → this node should stay
                    hasExternalVisibleParent = true;
                    break;
                }
                if (hasExternalVisibleParent) {
                    candidates.delete(nodeId);
                    changed = true; // removing a candidate may free others, so loop again
                }
            }
        }

        // Hide all remaining candidates
        for (const nodeId of candidates) {
            hiddenNodes.add(nodeId);
            if (!collapsedBy.has(nodeId)) collapsedBy.set(nodeId, new Set());
            collapsedBy.get(nodeId).add(clickedId);
        }
    }

    // Expand: restore nodes collapsed by clickedId
    function expandNode(clickedId) {
        const toRestore = [];
        for (const [nodeId, collapsers] of collapsedBy.entries()) {
            collapsers.delete(clickedId);
            if (collapsers.size === 0) {
                toRestore.push(nodeId);
            }
        }
        toRestore.forEach(id => {
            hiddenNodes.delete(id);
            collapsedBy.delete(id);
        });
    }

    // Restore all hidden nodes
    function restoreAll() {
        hiddenNodes.clear();
        collapsedBy.clear();
        collapsedNodes.clear();
        updateGraph();
    }

    const collapsedNodes = new Set(); // set of node ids the user has "collapsed"

    // Dimensions
    const containerRect = container.getBoundingClientRect();
    const width = Math.max(containerRect.width, 800);
    const height = Math.max(500, Math.min(allNodesData.length * 40, 900));

    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    // Defs for arrow marker
    svg.append('defs').append('marker')
        .attr('id', 'arrowhead')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', '#a0aec0');

    const g = svg.append('g');

    // Tooltip
    const tooltip = d3.select('body').append('div')
        .attr('class', 'tree-tooltip')
        .style('display', 'none');

    // Groups for links and nodes (so links are always behind)
    const linkGroup = g.append('g');
    const nodeGroup = g.append('g');

    // Simulation
    let simulation;

    function getVisibleNodes() {
        return allNodesData.filter(n => !hiddenNodes.has(n.id));
    }

    function getVisibleLinks() {
        return allLinksData.filter(l => {
            const srcId = typeof l.source === 'object' ? l.source.id : l.source;
            const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
            // Hide if either endpoint is hidden
            if (hiddenNodes.has(srcId) || hiddenNodes.has(tgtId)) return false;
            // Also hide edges from a collapsed node to its children (they are conceptually folded away)
            if (collapsedNodes.has(srcId)) return false;
            return true;
        });
    }

    function updateGraph() {
        const visibleNodes = getVisibleNodes();
        const visibleLinks = getVisibleLinks().map(l => ({
            source: typeof l.source === 'object' ? l.source.id : l.source,
            target: typeof l.target === 'object' ? l.target.id : l.target,
        }));

        // Show/hide restore button
        if (hiddenNodes.size > 0) {
            restoreBtn.classList.remove('hidden');
            restoreBtn.textContent = `すべてのノードを表示 (${hiddenNodes.size}件 非表示)`;
        } else {
            restoreBtn.classList.add('hidden');
        }

        // Update links
        const linkSel = linkGroup.selectAll('line')
            .data(visibleLinks, d => `${d.source}-${d.target}`);
        linkSel.exit().remove();
        const linkEnter = linkSel.enter().append('line')
            .attr('class', 'graph-link')
            .attr('marker-end', 'url(#arrowhead)');
        const linkMerged = linkEnter.merge(linkSel);

        // Update nodes
        const nodeSel = nodeGroup.selectAll('g.graph-node')
            .data(visibleNodes, d => d.id);
        nodeSel.exit().remove();
        const nodeEnter = nodeSel.enter().append('g')
            .attr('class', 'graph-node');

        // Circle for new nodes
        nodeEnter.append('circle')
            .attr('stroke', '#fff')
            .attr('stroke-width', 2);

        // Label for new nodes
        nodeEnter.append('text')
            .attr('class', 'graph-label')
            .attr('dy', '0.35em');

        // Merge
        const nodeMerged = nodeEnter.merge(nodeSel);

        // Update circle attrs (including collapsed indicator)
        nodeMerged.select('circle')
            .attr('r', d => {
                if (d.isRoot) return 14;
                if (d.directChildren > 0) return Math.min(8 + d.directChildren * 1.5, 14);
                return 6;
            })
            .attr('fill', d => {
                if (collapsedNodes.has(d.id)) return '#cf222e';
                if (d.isRoot) return '#0969da';
                if (d.directChildren > 0) return '#6e40c9';
                return '#1a7f0e';
            })
            .attr('stroke', d => collapsedNodes.has(d.id) ? '#fee2e2' : '#fff')
            .attr('stroke-width', 2);

        // Update text
        nodeMerged.select('text')
            .text(d => {
                const n = d.name;
                const label = n.length > 25 ? n.substring(0, 22) + '...' : n;
                return collapsedNodes.has(d.id) ? `▶ ${label}` : label;
            })
            .attr('dx', d => (d.isRoot ? 18 : d.directChildren > 0 ? 14 : 10));

        // Drag
        nodeMerged.call(d3.drag()
            .on('start', dragStarted)
            .on('drag', dragged)
            .on('end', dragEnded)
        );

        // Click to collapse/expand
        nodeMerged.on('click', (event, d) => {
            event.stopPropagation();
            if (d.directChildren === 0) return; // leaf nodes can't collapse

            if (collapsedNodes.has(d.id)) {
                // Expand
                collapsedNodes.delete(d.id);
                expandNode(d.id);
            } else {
                // Collapse
                collapsedNodes.add(d.id);
                collapseNode(d.id);
            }
            updateGraph();
        });

        // Hover interactions
        nodeMerged
            .on('mouseover', (event, d) => {
                const vLinks = getVisibleLinks();
                const connectedIds = new Set();
                connectedIds.add(d.id);
                vLinks.forEach(l => {
                    const src = typeof l.source === 'object' ? l.source.id : l.source;
                    const tgt = typeof l.target === 'object' ? l.target.id : l.target;
                    if (src === d.id) connectedIds.add(tgt);
                    if (tgt === d.id) connectedIds.add(src);
                });

                nodeMerged.classed('dimmed', n => !connectedIds.has(n.id));
                linkMerged.classed('dimmed', l => {
                    const src = typeof l.source === 'object' ? l.source.id : l.source;
                    const tgt = typeof l.target === 'object' ? l.target.id : l.target;
                    return src !== d.id && tgt !== d.id;
                });

                const parentNames = d.parentRefs.map(p => {
                    const pc = nameMap[p];
                    return pc ? pc.name : p;
                });

                let html = `<div class="tt-name">${escapeHtml(d.label)}</div>`;
                if (d.comp && d.comp.type) html += `<div class="tt-row">タイプ: ${escapeHtml(d.comp.type)}</div>`;
                if (d.comp && d.comp.licenses && d.comp.licenses.length > 0) html += `<div class="tt-row">ライセンス: ${escapeHtml(d.comp.licenses.join(', '))}</div>`;

                if (parentNames.length > 0) {
                    html += `<div class="tt-row tt-section">親: ${escapeHtml(parentNames.join(', '))}</div>`;
                } else {
                    html += `<div class="tt-row tt-section">親: なし (ルート)</div>`;
                }

                html += `<div class="tt-row">直接の子ノード: <strong>${d.directChildren}</strong></div>`;
                html += `<div class="tt-row">子孫ノード合計: <strong>${d.totalDescendants}</strong></div>`;

                if (collapsedNodes.has(d.id)) {
                    html += `<div class="tt-row" style="color:#cf222e;margin-top:4px">クリックで展開</div>`;
                } else if (d.directChildren > 0) {
                    html += `<div class="tt-row" style="color:#6e40c9;margin-top:4px">クリックで折りたたみ</div>`;
                }

                if (d.comp && d.comp.purl) html += `<div class="tt-row tt-purl">${escapeHtml(d.comp.purl)}</div>`;

                tooltip.html(html).style('display', 'block');
            })
            .on('mousemove', (event) => {
                tooltip
                    .style('left', (event.pageX + 15) + 'px')
                    .style('top', (event.pageY - 10) + 'px');
            })
            .on('mouseout', () => {
                nodeMerged.classed('dimmed', false);
                linkMerged.classed('dimmed', false);
                tooltip.style('display', 'none');
            });

        // Restart simulation
        if (simulation) simulation.stop();

        simulation = d3.forceSimulation(visibleNodes)
            .force('link', d3.forceLink(visibleLinks).id(d => d.id).distance(100).strength(0.4))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(35))
            .force('x', d3.forceX(width / 2).strength(0.05))
            .force('y', d3.forceY(height / 2).strength(0.05));

        simulation.on('tick', () => {
            linkMerged
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);
            nodeMerged.attr('transform', d => `translate(${d.x},${d.y})`);
        });
    }

    // Initial render
    updateGraph();

    // Drag handlers
    function dragStarted(event, d) {
        if (!event.active && simulation) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }
    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }
    function dragEnded(event, d) {
        if (!event.active && simulation) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    // Zoom
    const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        });

    svg.call(zoom);

    // Controls
    document.getElementById('reset-zoom').onclick = () => {
        svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
    };

    document.getElementById('expand-all').onclick = () => {
        svg.transition().duration(500).call(
            zoom.transform,
            d3.zoomIdentity.translate(width / 4, height / 4).scale(0.5)
        );
    };

    document.getElementById('collapse-all').onclick = () => {
        svg.transition().duration(500).call(
            zoom.transform,
            d3.zoomIdentity.translate(width / 2 - width / 4, height / 2 - height / 4).scale(1.5)
        );
    };

    restoreBtn.onclick = () => {
        restoreAll();
    };
}
