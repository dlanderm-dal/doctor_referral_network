// ===== ALPINE.JS STORE (UI state) =====
document.addEventListener('alpine:init', () => {
  Alpine.store('ui', {
    notesOpen: false,
    debugOpen: false,
    toggleNotes() { this.notesOpen = !this.notesOpen; },
    toggleDebug() { this.debugOpen = !this.debugOpen; },
  });
});

// ===== STATE =====
let doctors = [];
let edges = [];
let nextId = 1;
let customTags = [];
let tagOverrides = {};
let globalNotes = '';
let viewMode = 'nucleus';

let pan = { x: 0, y: 0 };
let zoom = 1;
let isPanning = false;
let panStart = { x: 0, y: 0 };

let connectingFrom = null;
let connectBanner = null;

const world = document.getElementById('world');
const canvas = document.getElementById('canvas');
const svg = document.getElementById('lines-svg');
const sidebar = document.getElementById('sidebar');

const TAG_COLORS = ['green','red','amber','blue','purple','teal','gray','pink','indigo','lime','cyan','rose'];
const TAG_COLOR_HEX = {green:'#22c55e',red:'#ef4444',amber:'#f59e0b',blue:'#3b82f6',purple:'#a855f7',teal:'#14b8a6',gray:'#94a3b8',pink:'#ec4899',indigo:'#6366f1',lime:'#84cc16',cyan:'#06b6d4',rose:'#f43f5e'};

const DEFAULT_TAGS = [
  { id: 'insurance', label: 'Insurance', color: 'green', dualMode: true },
  { id: 'new-patients', label: 'Accepts New Patients', color: 'blue', dualMode: true },
  { id: 'reading-fee', label: 'Reading Fee', color: 'amber' },
  { id: 'telehealth', label: 'Telehealth Available', color: 'purple' },
];

const DEFAULT_ACTION_TYPES = [
  { id: 'act-called', label: 'Called', color: 'blue' },
  { id: 'act-emailed', label: 'Emailed', color: 'purple' },
  { id: 'act-visited', label: 'Visited', color: 'green' },
  { id: 'act-noresp', label: 'No Response', color: 'red' },
  { id: 'act-redirected', label: 'Redirected', color: 'amber' },
  { id: 'act-custom', label: 'Custom', color: 'gray' },
  { id: 'act-document', label: 'Drop Document', color: 'teal' },
];
let customActionTypes = [];
let actionTypeOverrides = {};

function allActionTypes() {
  const merged = DEFAULT_ACTION_TYPES.map(t => ({ ...t, ...(actionTypeOverrides[t.id] || {}) }));
  return [...merged, ...customActionTypes];
}
function getActionTypeById(id) { return allActionTypes().find(t => t.id === id); }

// Keep backward compat with old ACTION_TYPES references
const ACTION_TYPES = DEFAULT_ACTION_TYPES.map(t => ({ value: t.label, color: t.color }));

const PHONE_REGEX = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/g;

let sidebarMode = null;
let sidebarDocId = null;
let sidebarParentId = null;
let sidebarTempTags = [];
let sidebarTempMisc = [];
let sidebarTempActionTags = [];
let sidebarTempActionMisc = [];
let sidebarTempLinks = [];
let sidebarTempActionLinks = [];
let sidebarNodeDoctors = [];
let newTagColor = 'gray';
let openDropdownId = null;

// ===== UTILS =====
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}
function genId() { return nextId++; }
function screenToWorld(sx, sy) { return { x: (sx - pan.x) / zoom, y: (sy - pan.y) / zoom }; }
function updateEmpty() { document.getElementById('empty-state').style.display = doctors.length === 0 ? '' : 'none'; }

function allTags() {
  const merged = DEFAULT_TAGS.map(t => ({ ...t, ...(tagOverrides[t.id] || {}) }));
  return [...merged, ...customTags];
}
function getTagById(id) {
  // Handle dual-mode composite IDs like "insurance:yes" or "insurance:no"
  if (id && id.includes(':')) {
    const [baseId, mode] = id.split(':');
    const baseTag = allTags().find(t => t.id === baseId);
    if (baseTag && baseTag.dualMode) {
      if (mode === 'yes') return { ...baseTag, label: baseTag.label + ' ✓', color: 'green', _dualBase: baseId, _dualMode: 'yes' };
      if (mode === 'no') return { ...baseTag, label: baseTag.label + ' ✗', color: 'red', _dualBase: baseId, _dualMode: 'no' };
    }
  }
  return allTags().find(t => t.id === id);
}
function todayStr() { return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function todayISO() { return new Date().toISOString().split('T')[0]; }
function showAutosave() {
  const el = document.getElementById('autosave-indicator');
  el.textContent = 'Saving...'; el.classList.add('saving');
  setTimeout(() => { el.textContent = 'Saved'; el.classList.remove('saving'); }, 600);
}

function detectPhoneNumbers(text) {
  const matches = text.match(PHONE_REGEX);
  return matches ? [...new Set(matches)] : [];
}
function phoneDigits(raw) {
  const d = raw.replace(/\D/g, '');
  return d.length === 10 ? '+1' + d : '+' + d;
}

// ===== NOTES PANEL =====
function updatePanelLayout() {
  const notesOpen = document.getElementById('notes-panel').classList.contains('open');
  const scrollOpen = document.getElementById('scroll-panel').classList.contains('open');
  document.getElementById('notes-btn').classList.toggle('active', notesOpen);
  document.getElementById('scroll-btn').classList.toggle('active', scrollOpen);
  document.getElementById('notes-panel').classList.toggle('half', notesOpen && scrollOpen);
  document.getElementById('scroll-panel').classList.toggle('half', notesOpen && scrollOpen);
}
window.toggleNotes = function() {
  document.getElementById('notes-panel').classList.toggle('open');
  updatePanelLayout();
};

// ===== SCROLL PANEL =====
window.toggleScroll = function() {
  document.getElementById('scroll-panel').classList.toggle('open');
  updatePanelLayout();
  if (document.getElementById('scroll-panel').classList.contains('open')) renderScrollPanel();
};

function renderScrollPanel() {
  const list = document.getElementById('scroll-list');
  if (!list) return;
  const activeDocs = doctors
    .filter(d => !d.closedOut && !d.isNode && !d.isDeactivated)
    .sort((a, b) => {
      const da = a.addedAt ? new Date(a.addedAt) : new Date(0);
      const db = b.addedAt ? new Date(b.addedAt) : new Date(0);
      return db - da;
    });

  if (activeDocs.length === 0) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:13px">No active doctors yet</div>';
    return;
  }

  list.innerHTML = activeDocs.map(d => {
    const tagsHtml = (d.tags||[]).slice(0,3).map(tid => {
      const tag = getTagById(tid);
      return tag ? `<span class="n-tag ${tag.color}">${tag.label}</span>` : '';
    }).join('');
    const lastAction = (d.actions||[]).length > 0 ? d.actions[d.actions.length-1] : null;
    const dateStr = lastAction ? lastAction.date : '';
    return `<div class="scroll-item ${d.isPatient?'is-patient':''}" data-scroll-id="${d.id}">
      <div class="scroll-item-top">
        <div>
          <div class="scroll-item-name">${d.name}</div>
          ${d.specialty ? `<div class="scroll-item-spec">${d.specialty}</div>` : ''}
        </div>
        ${dateStr ? `<div class="scroll-item-date">${dateStr}</div>` : ''}
        <button class="scroll-item-edit" data-scroll-edit="${d.id}" title="Edit">✎</button>
      </div>
      ${tagsHtml ? `<div class="scroll-item-tags">${tagsHtml}</div>` : ''}
    </div>`;
  }).join('');

  list.querySelectorAll('.scroll-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('.scroll-item-edit')) return;
      panToNode(parseInt(item.dataset.scrollId));
    });
  });

  list.querySelectorAll('.scroll-item-edit').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openSidebarEdit(parseInt(btn.dataset.scrollEdit));
    });
  });
}

function panToNode(docId) {
  const doc = doctors.find(d => d.id === docId);
  if (!doc) return;
  const el = document.getElementById('node-' + docId);
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  const nodeW = 240, nodeH = el ? el.offsetHeight : 100;
  // Center the node in the viewport
  pan.x = cw / 2 - (doc.x + nodeW / 2) * zoom;
  pan.y = ch / 2 - (doc.y + nodeH / 2) * zoom;
  clampPan();
  updateTransform();
  // Highlight the node briefly
  if (el) {
    el.classList.add('highlighted');
    setTimeout(() => el.classList.remove('highlighted'), 1500);
  }
}
document.getElementById('notes-textarea').addEventListener('input', (e) => { globalNotes = e.target.value; save(); });

// ===== AUTO LAYOUT (d3-force with tree-aware positioning) =====

// Find connected components (subtrees)
function findComponents() {
  const visited = new Set();
  const components = [];
  doctors.forEach(d => {
    if (visited.has(d.id)) return;
    const comp = [];
    const queue = [d.id];
    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      comp.push(id);
      edges.filter(e => e.from === id).forEach(e => { if (!visited.has(e.to)) queue.push(e.to); });
      edges.filter(e => e.to === id).forEach(e => { if (!visited.has(e.from)) queue.push(e.from); });
    }
    components.push(comp);
  });
  return components;
}

function layoutAll() {
  if (doctors.length === 0) return;
  if (viewMode === 'hierarchy') { layoutHierarchy(); return; }

  // Filter: if hiding inactive, exclude closedOut and deactivated doctors
  const hideInactive = document.getElementById('hide-inactive')?.checked || false;
  const activeDocs = hideInactive ? doctors.filter(d => !d.closedOut && !d.isDeactivated) : doctors;
  const activeIds = new Set(activeDocs.map(d => d.id));
  const activeEdges = edges.filter(e => activeIds.has(e.from) && activeIds.has(e.to));

  // ===== CLOCK-FACE RADIAL LAYOUT =====
  const targeted = new Set(activeEdges.map(e => e.to));
  const roots = activeDocs.filter(d => !targeted.has(d.id));
  if (roots.length === 0 && activeDocs.length > 0) roots.push(activeDocs[0]);

  const nodeW = 240;

  // Build subtree for each root
  function buildSubtree(rootId) {
    const tree = { id: rootId, children: [], allDescendants: [], allIds: new Set([rootId]) };
    const visited = new Set([rootId]);
    const queue = [rootId];
    while (queue.length > 0) {
      const parentId = queue.shift();
      const kids = activeEdges.filter(e => e.from === parentId).map(e => e.to).filter(cid => !visited.has(cid));
      kids.forEach(cid => { visited.add(cid); tree.allDescendants.push(cid); tree.allIds.add(cid); queue.push(cid); });
      if (parentId === rootId) tree.children = kids;
    }
    return tree;
  }

  let trees = roots.map(r => buildSubtree(r.id));

  // ===== CROSS-TREE EDGE OPTIMIZATION =====
  // Identify cross-tree edges (connecting nodes in different trees)
  const nodeToTree = {};
  trees.forEach((t, ti) => { t.allIds.forEach(id => { nodeToTree[id] = ti; }); });
  const crossEdges = activeEdges.filter(e => nodeToTree[e.from] !== undefined && nodeToTree[e.to] !== undefined && nodeToTree[e.from] !== nodeToTree[e.to]);

  // Try permutations of root ordering to minimize cross-tree edge angular distance
  // (For <= 8 roots, test all permutations; for more, use greedy swapping)
  if (crossEdges.length > 0 && trees.length > 1 && trees.length <= 8) {
    function scorePerm(perm) {
      // Score = sum of angular distances for cross-tree edges
      const totalWeight = perm.reduce((s, t) => s + Math.max(t.allDescendants.length, 1), 0);
      const angles = {};
      let cur = -Math.PI / 2;
      perm.forEach(t => {
        const w = Math.max(t.allDescendants.length, 1);
        const arc = (w / totalWeight) * 2 * Math.PI;
        const mid = cur + arc / 2;
        t.allIds.forEach(id => { angles[id] = mid; });
        cur += arc;
      });
      let score = 0;
      crossEdges.forEach(e => {
        const a1 = angles[e.from] || 0, a2 = angles[e.to] || 0;
        let diff = Math.abs(a1 - a2);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        score += diff;
      });
      return score;
    }

    // For small tree counts, try all permutations
    function permutations(arr) {
      if (arr.length <= 1) return [arr];
      const result = [];
      arr.forEach((item, i) => {
        const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
        permutations(rest).forEach(p => result.push([item, ...p]));
      });
      return result;
    }

    let bestPerm = trees, bestScore = scorePerm(trees);
    const perms = trees.length <= 6 ? permutations(trees) : null;
    if (perms) {
      perms.forEach(p => { const s = scorePerm(p); if (s < bestScore) { bestScore = s; bestPerm = p; } });
    } else {
      // Greedy: try swapping pairs
      for (let a = 0; a < trees.length; a++) {
        for (let b = a + 1; b < trees.length; b++) {
          const swapped = [...trees]; swapped[a] = trees[b]; swapped[b] = trees[a];
          const s = scorePerm(swapped);
          if (s < bestScore) { bestScore = s; bestPerm = [...swapped]; }
        }
      }
    }
    trees = bestPerm;
  }

  // ===== PLACE ROOTS ON CLOCK FACE =====
  const totalWeight = trees.reduce((sum, t) => sum + Math.max(t.allDescendants.length, 1), 0);
  const innerRadius = Math.max(120, Math.min(250, trees.length * 30));
  let currentAngle = -Math.PI / 2;

  // Store root radii for enforcement later
  const nodeMinRadius = {}; // nodeId -> minimum distance from center

  trees.forEach(tree => {
    const weight = Math.max(tree.allDescendants.length, 1);
    const arcSize = (weight / totalWeight) * 2 * Math.PI;
    const rootAngle = currentAngle + arcSize / 2;

    const rootDoc = activeDocs.find(d => d.id === tree.id);
    if (rootDoc) {
      rootDoc.x = Math.cos(rootAngle) * innerRadius - nodeW / 2;
      rootDoc.y = Math.sin(rootAngle) * innerRadius;
      nodeMinRadius[tree.id] = innerRadius;
    }

    // Fan out children — each level further out, never closer to center than parent
    function layoutChildren(parentId, arcStart, arcEnd, depth) {
      const kids = activeEdges.filter(e => e.from === parentId).map(e => e.to)
        .filter(cid => tree.allIds.has(cid) && cid !== tree.id);
      // Deduplicate (in case of multiple edges)
      const uniqueKids = [...new Set(kids)].filter(cid => activeDocs.find(d => d.id === cid));
      if (uniqueKids.length === 0) return;

      const parentMinR = nodeMinRadius[parentId] || innerRadius;
      const radius = parentMinR + 320; // always push further out
      const arcSpan = arcEnd - arcStart;

      uniqueKids.forEach((cid, i) => {
        const childDoc = activeDocs.find(d => d.id === cid);
        if (!childDoc) return;

        let childAngle;
        if (uniqueKids.length === 1) {
          childAngle = (arcStart + arcEnd) / 2;
        } else {
          const pad = arcSpan * 0.06;
          childAngle = (arcStart + pad) + ((arcEnd - pad) - (arcStart + pad)) * (i / (uniqueKids.length - 1));
        }

        childDoc.x = Math.cos(childAngle) * radius - nodeW / 2;
        childDoc.y = Math.sin(childAngle) * radius;
        nodeMinRadius[cid] = radius; // enforce: this child's minimum

        const childArcSize = arcSpan / uniqueKids.length;
        layoutChildren(cid, arcStart + childArcSize * i, arcStart + childArcSize * (i + 1), depth + 1);
      });
    }

    layoutChildren(tree.id, currentAngle, currentAngle + arcSize, 1);
    currentAngle += arcSize;
  });

  // Handle any remaining unplaced nodes (circular refs etc) — treat as roots on the clock
  const placed = new Set();
  trees.forEach(t => t.allIds.forEach(id => placed.add(id)));
  const orphans = activeDocs.filter(d => !placed.has(d.id));
  if (orphans.length > 0) {
    // Distribute them evenly on the clock face at the same radius as roots
    const orphanArcStart = currentAngle;
    orphans.forEach((d, i) => {
      const angle = orphanArcStart + (2 * Math.PI * i) / Math.max(orphans.length, 1);
      d.x = Math.cos(angle) * innerRadius - nodeW / 2;
      d.y = Math.sin(angle) * innerRadius;
      nodeMinRadius[d.id] = innerRadius;
    });
  }

  // d3-force: collision resolution only
  const simNodes = activeDocs.map(d => ({
    id: d.id, x: d.x || 0, y: d.y || 0,
    width: nodeW, height: estimateNodeHeight(d)
  }));

  const sim = d3.forceSimulation(simNodes)
    .force('collide', d3.forceCollide().radius(sn => Math.max(sn.width, sn.height) / 2 + 25).strength(0.7).iterations(3))
    .stop();

  for (let i = 0; i < 150; i++) sim.tick();

  // Apply positions, then enforce radial minimum (children can't be closer to center than parent)
  simNodes.forEach(sn => {
    const doc = activeDocs.find(d => d.id === sn.id);
    if (!doc) return;
    doc.x = Math.round(sn.x);
    doc.y = Math.round(sn.y);
  });

  // Post-process: enforce radial minimum distance
  activeDocs.forEach(d => {
    const minR = nodeMinRadius[d.id];
    if (minR === undefined) return;
    const cx = d.x + nodeW / 2, cy = d.y;
    const distFromCenter = Math.sqrt(cx * cx + cy * cy);
    if (distFromCenter < minR * 0.85) {
      // Push outward to at least minR
      const angle = Math.atan2(cy, cx);
      d.x = Math.round(Math.cos(angle) * minR - nodeW / 2);
      d.y = Math.round(Math.sin(angle) * minR);
    }
  });

  // Hide inactive nodes visually
  doctors.forEach(d => {
    const el = document.getElementById('node-' + d.id);
    if (el) el.style.display = (hideInactive && (d.closedOut || d.isDeactivated)) ? 'none' : '';
  });
}

// Refresh layout — randomizes starting positions then re-runs simulation
// ===== HIERARCHY LAYOUT (tidy tree + gap + stagger) =====
function layoutHierarchy() {
  const hideInactive = document.getElementById('hide-inactive')?.checked || false;
  const activeDocs = hideInactive ? doctors.filter(d => !d.closedOut && !d.isDeactivated) : doctors;
  const activeIds = new Set(activeDocs.map(d => d.id));
  const activeEdges = edges.filter(e => activeIds.has(e.from) && activeIds.has(e.to));

  if (activeDocs.length === 0) return;

  const NODE_WIDTH = 260;
  const H_GAP = 20;        // gap between leaf children within same parent
  const SIBLING_GAP = 80;  // extra gap between sibling subtrees
  const V_SPACING = 200;   // vertical distance between levels
  const STAGGER = 50;      // vertical offset for alternating sibling groups

  // Identify roots (no incoming edges)
  const targeted = new Set(activeEdges.map(e => e.to));
  let roots = activeDocs.filter(d => !targeted.has(d.id));
  if (roots.length === 0) roots = [activeDocs[0]];

  // Build adjacency (parent -> children)
  const childrenOf = {};
  activeDocs.forEach(d => { childrenOf[d.id] = []; });
  const visited = new Set();
  activeEdges.forEach(e => {
    if (childrenOf[e.from]) childrenOf[e.from].push(e.to);
  });

  // Recursive: calculate subtree width (bottom-up)
  // Uses SIBLING_GAP between sibling subtrees, H_GAP between leaf children
  const subtreeWidth = {};
  function calcWidth(id) {
    if (visited.has(id)) return 0;
    visited.add(id);
    const kids = (childrenOf[id] || []).filter(cid => !visited.has(cid));
    childrenOf[id] = kids;
    if (kids.length === 0) {
      subtreeWidth[id] = NODE_WIDTH;
      return NODE_WIDTH;
    }
    let totalW = 0;
    kids.forEach((cid, i) => {
      totalW += calcWidth(cid);
      if (i < kids.length - 1) totalW += SIBLING_GAP;
    });
    subtreeWidth[id] = Math.max(NODE_WIDTH, totalW);
    return subtreeWidth[id];
  }

  visited.clear();
  roots.forEach(r => calcWidth(r));

  // Assign orphans as additional roots
  activeDocs.forEach(d => {
    if (!visited.has(d.id)) {
      visited.add(d.id);
      subtreeWidth[d.id] = NODE_WIDTH;
      childrenOf[d.id] = [];
      roots.push(d);
    }
  });

  // Recursive: place subtree at (xCenter, y)
  // siblingIndex: which sibling this node is among its parent's children (for stagger)
  function placeSubtree(id, xCenter, y, siblingIndex) {
    const doc = activeDocs.find(d => d.id === id);
    if (!doc) return;

    // Apply vertical stagger: even-indexed siblings at base y, odd ones offset down
    const staggerOffset = (siblingIndex % 2 === 1) ? STAGGER : 0;
    doc.x = xCenter - NODE_WIDTH / 2;
    doc.y = y + staggerOffset;

    const kids = childrenOf[id] || [];
    if (kids.length === 0) return;

    const totalChildrenWidth = kids.reduce((sum, cid, i) => {
      return sum + subtreeWidth[cid] + (i < kids.length - 1 ? SIBLING_GAP : 0);
    }, 0);

    let cx = xCenter - totalChildrenWidth / 2;
    kids.forEach((cid, i) => {
      const cw = subtreeWidth[cid];
      placeSubtree(cid, cx + cw / 2, y + staggerOffset + V_SPACING, i);
      cx += cw + SIBLING_GAP;
    });
  }

  // Place all root subtrees on one horizontal line
  const TREE_GAP = 100;

  let totalRootWidth = roots.reduce((sum, r, i) => {
    return sum + subtreeWidth[r.id] + (i < roots.length - 1 ? TREE_GAP : 0);
  }, 0);

  let rx = -totalRootWidth / 2;
  roots.forEach((r, i) => {
    const tw = subtreeWidth[r.id];
    placeSubtree(r.id, rx + tw / 2, 0, 0);
    rx += tw + TREE_GAP;
  });
}

// ===== VIEW MODE =====
window.setViewMode = function(mode) {
  viewMode = mode;
  // Update radio button UI
  document.querySelectorAll('.tb-view-opt').forEach(el => el.classList.remove('active'));
  const activeBtn = document.getElementById('view-' + mode);
  if (activeBtn) activeBtn.classList.add('active');
  // Reset positions and re-layout
  const hideInactive = document.getElementById('hide-inactive')?.checked || false;
  doctors.forEach(d => {
    if (!hideInactive || (!d.closedOut && !d.isDeactivated)) { d.x = 0; d.y = 0; }
  });
  layoutAll();
  renderAll();
  fitView();
  save();
};

window.refreshLayout = function() {
  if (doctors.length === 0) return;
  const hideInactive = document.getElementById('hide-inactive')?.checked || false;
  doctors.forEach(d => {
    if (!hideInactive || (!d.closedOut && !d.isDeactivated)) { d.x = 0; d.y = 0; }
  });
  layoutAll();
  renderAll();
  fitView();
  save();
  toast('Layout refreshed!');
};

window.toggleHideInactive = function() {
  // Only reset positions for active doctors; inactive keep their old positions
  const hideInactive = document.getElementById('hide-inactive')?.checked || false;
  doctors.forEach(d => {
    if (!hideInactive || (!d.closedOut && !d.isDeactivated)) { d.x = 0; d.y = 0; }
  });
  layoutAll();
  renderAll();
  fitView();
};
function estimateNodeHeight(doc) {
  let h = 44;
  const tc = (doc.tags||[]).length + (doc.miscNotes||[]).length;
  if (tc > 0) h += 30 + Math.floor(tc/4)*22;
  if ((doc.links||[]).length > 0) h += 28;
  h += (doc.actions||[]).length * 34;
  h += 36;
  return Math.max(h, 100);
}

// ===== PAN/ZOOM =====
function getWorldBounds() {
  if (doctors.length === 0) return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  doctors.forEach(d => {
    const el = document.getElementById('node-'+d.id);
    const h = el ? el.offsetHeight : estimateNodeHeight(d);
    minX=Math.min(minX,d.x); minY=Math.min(minY,d.y);
    maxX=Math.max(maxX,d.x+240); maxY=Math.max(maxY,d.y+h);
  });
  return {minX,minY,maxX,maxY};
}
function clampPan() {
  const b = getWorldBounds(); if(!b) return;
  const cw=canvas.clientWidth, ch=canvas.clientHeight, pad=120;
  const mxX=-(b.minX-pad)*zoom+cw*0.05, mnX=-(b.maxX+pad)*zoom+cw*0.95;
  const mxY=-(b.minY-pad)*zoom+ch*0.05, mnY=-(b.maxY+pad)*zoom+ch*0.95;
  if(mxX>mnX) pan.x=Math.max(mnX,Math.min(mxX,pan.x));
  if(mxY>mnY) pan.y=Math.max(mnY,Math.min(mxY,pan.y));
}
function getFitZoom() {
  const b=getWorldBounds(); if(!b) return 1;
  const cw=canvas.clientWidth, ch=canvas.clientHeight, pad=60;
  const ww=b.maxX-b.minX+pad*2, wh=b.maxY-b.minY+pad*2;
  return Math.min(2, Math.max(0.3, Math.min(cw/ww, ch/wh)));
}
function updateTransform() {
  world.style.transform = `translate(${pan.x}px,${pan.y}px) scale(${zoom})`;
  document.getElementById('zoom-label').textContent = Math.round(zoom*100)+'%';
}

// ===== RENDER =====
function renderEdges() {
  svg.querySelectorAll('path,text,rect').forEach(el=>el.remove());

  // Determine which tree each node belongs to (for cross-tree detection)
  const targeted = new Set(edges.map(e => e.to));
  const roots = doctors.filter(d => !targeted.has(d.id));
  const nodeTreeMap = {};
  roots.forEach((r, ri) => {
    const visited = new Set([r.id]);
    const queue = [r.id];
    nodeTreeMap[r.id] = ri;
    while (queue.length > 0) {
      const id = queue.shift();
      edges.filter(e => e.from === id).forEach(e => {
        if (!visited.has(e.to)) { visited.add(e.to); nodeTreeMap[e.to] = ri; queue.push(e.to); }
      });
    }
  });

  const hideInactive = document.getElementById('hide-inactive')?.checked || false;

  edges.forEach(edge => {
    const from=doctors.find(d=>d.id===edge.from), to=doctors.find(d=>d.id===edge.to);
    if(!from||!to) return;
    // Skip edges to/from hidden nodes
    if (hideInactive && (from.closedOut || from.isDeactivated || to.closedOut || to.isDeactivated)) return;

    const fe=document.getElementById('node-'+from.id), te=document.getElementById('node-'+to.id);
    if (fe && fe.style.display === 'none') return;
    if (te && te.style.display === 'none') return;

    const fw=240, fh=fe?fe.offsetHeight:100, tw=240, th=te?te.offsetHeight:100;
    const fcx=from.x+fw/2, fcy=from.y+fh/2;
    const tcx=to.x+tw/2, tcy=to.y+th/2;

    // Detect cross-tree edge
    const isCrossTree = nodeTreeMap[edge.from] !== undefined && nodeTreeMap[edge.to] !== undefined && nodeTreeMap[edge.from] !== nodeTreeMap[edge.to];

    const path=document.createElementNS('http://www.w3.org/2000/svg','path');

    if (viewMode === 'hierarchy') {
      // 90-degree bracket connectors: down from parent bottom, horizontal, down to child top
      const x1 = fcx, y1 = from.y + fh;  // bottom center of parent
      const x2 = tcx, y2 = to.y;          // top center of child
      const midY = y1 + (y2 - y1) / 2;    // horizontal bar midpoint
      path.setAttribute('d', `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`);

      if (isCrossTree) {
        path.setAttribute('stroke', '#f59e0b');
        path.setAttribute('stroke-width', '2.5');
        path.setAttribute('stroke-dasharray', '6,3');
        path.style.opacity = '0.7';
      }
    } else {
      // Nucleus mode: bezier curves
      const dx=tcx-fcx, dy=tcy-fcy;
      const angle=Math.atan2(dy,dx);
      let x1,y1,x2,y2;
      if(Math.abs(Math.cos(angle))*(fh/2) > Math.abs(Math.sin(angle))*(fw/2)) {
        x1=dx>0?from.x+fw:from.x; y1=fcy;
        x2=dx>0?to.x:to.x+tw; y2=tcy;
      } else {
        x1=fcx; y1=dy>0?from.y+fh:from.y;
        x2=tcx; y2=dy>0?to.y:to.y+th;
      }
      const edx=x2-x1, edy=y2-y1, elen=Math.sqrt(edx*edx+edy*edy);
      if(elen>12) { x2-=(edx/elen)*6; y2-=(edy/elen)*6; }
      const cpDist=Math.max(50, elen*0.3);
      const cpx1=x1+Math.cos(angle)*cpDist, cpy1=y1+Math.sin(angle)*cpDist;
      const cpx2=x2-Math.cos(angle)*cpDist, cpy2=y2-Math.sin(angle)*cpDist;
      path.setAttribute('d',`M ${x1} ${y1} C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${x2} ${y2}`);

      if (isCrossTree) {
        path.setAttribute('stroke', '#f59e0b');
        path.setAttribute('stroke-width', '3.5');
        path.setAttribute('stroke-dasharray', '8,4');
        path.setAttribute('marker-end', 'url(#arrowhead-cross)');
        path.style.opacity = '0.85';
      } else {
        path.setAttribute('marker-end', 'url(#arrowhead)');
      }
    }

    svg.appendChild(path);
    if(edge.label) {
      const mx=(x1+x2)/2, my=(y1+y2)/2;
      const text=document.createElementNS('http://www.w3.org/2000/svg','text');
      text.setAttribute('x',mx); text.setAttribute('y',my+3);
      text.setAttribute('class','edge-label'); text.textContent=edge.label;
      svg.appendChild(text);
      const bb=text.getBBox();
      const bg=document.createElementNS('http://www.w3.org/2000/svg','rect');
      bg.setAttribute('class','edge-label-bg');
      bg.setAttribute('x',bb.x-4); bg.setAttribute('y',bb.y-2);
      bg.setAttribute('width',bb.width+8); bg.setAttribute('height',bb.height+4);
      bg.setAttribute('rx',4); svg.insertBefore(bg,text);
    }
  });
}

function renderNode(doc) {
  let el=document.getElementById('node-'+doc.id);
  if(!el) { el=document.createElement('div'); el.className='doctor-node'; el.id='node-'+doc.id; world.appendChild(el); }
  el.style.left=doc.x+'px'; el.style.top=doc.y+'px';
  if(doc.closedOut) el.classList.add('closed-out'); else el.classList.remove('closed-out');
  if(doc.isNode) el.classList.add('is-node'); else el.classList.remove('is-node');
  if(doc.isPatient) el.classList.add('is-patient'); else el.classList.remove('is-patient');
  if(doc.isDeactivated) el.classList.add('is-deactivated'); else el.classList.remove('is-deactivated');

  const tagsHtml=(doc.tags||[]).map(tid=>{const tag=getTagById(tid);return tag?`<span class="n-tag ${tag.color||'gray'}">${tag.label}</span>`:''}).join('');
  const miscHtml=(doc.miscNotes||[]).map(m=>`<span class="n-tag gray">${m}</span>`).join('');
  const phoneNums=detectPhoneNumbers(doc.notes||'');
  const phonePillsHtml=phoneNums.length>0?`<div class="n-phones">${phoneNums.map(p=>`<a class="phone-pill" href="tel:${phoneDigits(p)}" onclick="event.stopPropagation()">${p}</a>`).join('')}</div>`:'';
  const linksHtml=(doc.links||[]).length>0?`<div class="n-links">${doc.links.map(l=>`<a class="n-link" href="${l.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${l.title||l.url}</a>`).join('')}</div>`:'';
  const actionsHtml=(doc.actions||[]).map(a=>{
    const isClosed=a.type==='closed';
    const dc=isClosed?'red':(a.dotColor||'blue');
    const at=(a.tags||[]).map(tid=>{const tag=getTagById(tid);return tag?`<span class="n-action-tag">${tag.label}</span>`:''}).concat((a.miscTags||[]).map(m=>`<span class="n-action-tag">${m}</span>`)).join('');
    return `<div class="n-action ${isClosed?'closed-action':''}"><span class="n-action-dot ${dc}"></span><div><div>${a.date?`<span style="color:#94a3b8;font-size:10px">${a.date}</span> `:''}${a.text}</div>${at?`<div class="n-action-tags">${at}</div>`:''}</div></div>`;
  }).join('');

  el.innerHTML=`
    <div class="n-header"><div class="n-name">${doc.name||'Unnamed'}</div>${doc.specialty?`<div class="n-specialty">${doc.specialty}</div>`:''}</div>
    ${(tagsHtml||miscHtml)?`<div class="n-tags">${tagsHtml}${miscHtml}</div>`:''}
    ${phonePillsHtml}
    ${linksHtml}
    ${actionsHtml?`<div class="n-actions">${actionsHtml}</div>`:''}
    <div class="n-footer">
      <button class="n-add-ref" data-id="${doc.id}">+ Add referral</button>
      <button class="n-connect-btn" data-id="${doc.id}">Link to...</button>
    </div>
  `;

  el.addEventListener('mousedown', e => {
    if(e.target.closest('.n-add-ref')||e.target.closest('.n-connect-btn')||e.target.closest('.n-link')||e.target.closest('.phone-pill')) return;
    if (e.button !== 0) return; // left click only
    startNodeDrag(doc, el, e);
  });
  el.addEventListener('click', e => {
    if(e.target.closest('.n-add-ref')||e.target.closest('.n-connect-btn')||e.target.closest('.n-link')||e.target.closest('.phone-pill')) return;
    if (draggingNode && draggingNode.moved) return; // was a drag, not a click
    if (connectingFrom !== null) { finishConnect(doc.id); return; }
    openSidebarEdit(doc.id);
  });
  el.querySelector('.n-add-ref').addEventListener('click', e => { e.stopPropagation(); openSidebarNewReferral(doc.id); });
  el.querySelector('.n-connect-btn').addEventListener('click', e => { e.stopPropagation(); startConnect(doc.id); });
}

function renderAll() {
  world.querySelectorAll('.doctor-node').forEach(el=>el.remove());
  doctors.forEach(renderNode);
  // Apply hide-inactive visibility
  const hideInactive = document.getElementById('hide-inactive')?.checked || false;
  if (hideInactive) {
    doctors.forEach(d => {
      const el = document.getElementById('node-' + d.id);
      if (el && (d.closedOut || d.isDeactivated)) el.style.display = 'none';
    });
  }
  renderEdges();
  updateEmpty();
  if (document.getElementById('scroll-panel')?.classList.contains('open')) renderScrollPanel();
}

// ===== CONNECT NODES =====
function startConnect(fromId) {
  connectingFrom = fromId;
  canvas.classList.add('connecting');
  const fromDoc = doctors.find(d => d.id === fromId);
  if (connectBanner) connectBanner.remove();
  connectBanner = document.createElement('div');
  connectBanner.className = 'connect-banner';
  connectBanner.innerHTML = `Click another node to connect from <strong>${fromDoc?.name || 'this node'}</strong> <button onclick="cancelConnect()">Cancel</button>`;
  document.body.appendChild(connectBanner);
}

window.cancelConnect = function() {
  connectingFrom = null;
  canvas.classList.remove('connecting');
  if (connectBanner) { connectBanner.remove(); connectBanner = null; }
};

function finishConnect(toId) {
  if (connectingFrom === null || connectingFrom === toId) { cancelConnect(); return; }
  const exists = edges.some(e => e.from === connectingFrom && e.to === toId);
  if (!exists) {
    edges.push({ from: connectingFrom, to: toId, label: '' });
    // Log the connection in both doctors' action logs
    const fromDoc = doctors.find(d => d.id === connectingFrom);
    const toDoc = doctors.find(d => d.id === toId);
    if (fromDoc) {
      if (!fromDoc.actions) fromDoc.actions = [];
      fromDoc.actions.push({ text: `Linked to ${toDoc?.name || 'node #'+toId}`, date: todayStr(), type: 'action', dotColor: 'teal', tags: [], miscTags: [], links: [] });
    }
    if (toDoc) {
      if (!toDoc.actions) toDoc.actions = [];
      toDoc.actions.push({ text: `Linked from ${fromDoc?.name || 'node #'+connectingFrom}`, date: todayStr(), type: 'action', dotColor: 'teal', tags: [], miscTags: [], links: [] });
    }
    layoutAll(); renderAll(); fitView(); save();
    toast('Connected!');
  } else {
    toast('Already connected');
  }
  cancelConnect();
}

// ===== TAG DROPDOWN =====
function renderTagDropdown(containerId, tempArr, onToggle, compact) {
  const area = document.getElementById(containerId);
  if (!area) return;
  const tags = allTags();
  const ddId = containerId + '-dd';
  const isOpen = openDropdownId === ddId;

  const pillsHtml = tempArr.map(tid => {
    const tag = getTagById(tid);
    if (!tag) return '';
    return `<span class="tag-pill ${tag.color}" data-tid="${tid}">${tag.label}<span class="tp-x" data-tid="${tid}">&times;</span></span>`;
  }).join('');

  const optsHtml = tags.map(tag => {
    if (tag.dualMode) {
      const yesId = tag.id + ':yes', noId = tag.id + ':no';
      const hasYes = tempArr.includes(yesId), hasNo = tempArr.includes(noId);
      return `<div class="tag-dd-opt tag-dd-dual" data-dual-id="${tag.id}">
        <span>${tag.label}</span>
        <span class="tag-dual-btns">
          <span class="tag-dual-btn tag-dual-yes ${hasYes?'active':''}" data-dual-tid="${yesId}" title="Yes" style="background:${hasYes?'#22c55e':'#e2e8f0'}">✓</span>
          <span class="tag-dual-btn tag-dual-no ${hasNo?'active':''}" data-dual-tid="${noId}" title="No" style="background:${hasNo?'#ef4444':'#e2e8f0'};color:${hasNo?'white':'#94a3b8'}">✗</span>
        </span>
        <span class="tag-dd-edit-btn" data-edit-tid="${tag.id}">\u270E</span>
      </div>`;
    }
    const sel = tempArr.includes(tag.id);
    return `<div class="tag-dd-opt ${sel?'selected':''}" data-tid="${tag.id}">
      <span class="tag-dd-dot" style="background:${TAG_COLOR_HEX[tag.color]||'#94a3b8'}"></span>
      <span>${tag.label}</span>
      ${sel ? '<span class="tag-dd-check">\u2713</span>' : '<span class="tag-dd-edit-btn" data-edit-tid="'+tag.id+'">\u270E</span>'}
    </div>`;
  }).join('');

  const cdots = TAG_COLORS.map(c =>
    `<span class="tag-dd-cdot ${c===newTagColor?'sel':''}" data-c="${c}" style="background:${TAG_COLOR_HEX[c]}"></span>`
  ).join('');

  area.innerHTML = `
    <div class="tag-dd-wrap">
      ${pillsHtml ? `<div class="tag-dd-pills">${pillsHtml}</div>` : ''}
      <div class="tag-dd-trigger" data-dd="${ddId}">${tempArr.length ? tempArr.length+' tag'+(tempArr.length>1?'s':'')+' selected' : 'Select tags...'}</div>
      <div class="tag-dd-panel ${isOpen?'open':''}" id="${ddId}">
        ${optsHtml}
        <div class="tag-dd-footer">
          <div class="tag-dd-new-row">
            <input type="text" class="tag-dd-new-input" id="${containerId}-new" placeholder="New tag...">
            <div class="tag-dd-color-dots">${cdots}</div>
            <button class="tag-dd-add-btn" data-container="${containerId}">+</button>
          </div>
          <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#94a3b8;cursor:pointer;margin-top:2px">
            <input type="checkbox" id="${containerId}-dual" style="width:13px;height:13px"> Yes/No tag
          </label>
        </div>
      </div>
    </div>
  `;

  area.querySelector('.tag-dd-trigger').addEventListener('click', () => {
    openDropdownId = isOpen ? null : ddId;
    renderTagDropdown(containerId, tempArr, onToggle, compact);
  });

  area.querySelectorAll('.tp-x').forEach(x => {
    x.addEventListener('click', e => {
      e.stopPropagation();
      const idx = tempArr.indexOf(x.dataset.tid);
      if (idx >= 0) tempArr.splice(idx, 1);
      renderTagDropdown(containerId, tempArr, onToggle, compact);
    });
  });

  area.querySelectorAll('.tag-dd-opt').forEach(opt => {
    opt.addEventListener('click', e => {
      if (e.target.closest('.tag-dd-edit-btn')) return;
      if (e.target.closest('.tag-dual-btn')) return; // handled separately
      if (opt.classList.contains('tag-dd-dual')) return; // dual-mode: use buttons
      const tid = opt.dataset.tid;
      const idx = tempArr.indexOf(tid);
      if (idx >= 0) tempArr.splice(idx, 1); else tempArr.push(tid);
      renderTagDropdown(containerId, tempArr, onToggle, compact);
    });
  });

  // Dual-mode tag buttons (yes/no)
  area.querySelectorAll('.tag-dual-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const tid = btn.dataset.dualTid; // e.g. "insurance:yes"
      const baseId = tid.split(':')[0];
      const yesId = baseId + ':yes', noId = baseId + ':no';
      // Remove opposite if present
      const yesIdx = tempArr.indexOf(yesId), noIdx = tempArr.indexOf(noId);
      if (btn.classList.contains('tag-dual-yes')) {
        if (yesIdx >= 0) { tempArr.splice(yesIdx, 1); } // toggle off
        else { if (noIdx >= 0) tempArr.splice(noIdx, 1); tempArr.push(yesId); } // toggle on, remove no
      } else {
        if (noIdx >= 0) { tempArr.splice(noIdx, 1); } // toggle off
        else { if (yesIdx >= 0) tempArr.splice(yesIdx, 1); tempArr.push(noId); } // toggle on, remove yes
      }
      renderTagDropdown(containerId, tempArr, onToggle, compact);
    });
  });

  area.querySelectorAll('.tag-dd-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      startTagEdit(btn.dataset.editTid, containerId, tempArr, onToggle, compact);
    });
  });

  area.querySelectorAll('.tag-dd-cdot').forEach(dot => {
    dot.addEventListener('click', e => {
      e.stopPropagation();
      // Save the input value before re-render
      const inputEl = area.querySelector(`#${containerId}-new`);
      const savedVal = inputEl ? inputEl.value : '';
      newTagColor = dot.dataset.c;
      renderTagDropdown(containerId, tempArr, onToggle, compact);
      // Restore the input value
      const restoredEl = area.querySelector(`#${containerId}-new`);
      if (restoredEl) restoredEl.value = savedVal;
    });
  });

  const addBtn = area.querySelector('.tag-dd-add-btn');
  const newInput = area.querySelector(`#${containerId}-new`);
  if (addBtn && newInput) {
    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      const val = newInput.value.trim();
      if (!val) return;
      const id = 'custom-' + Date.now();
      const isDual = document.getElementById(`${containerId}-dual`)?.checked || false;
      customTags.push({ id, label: val, color: newTagColor, ...(isDual ? { dualMode: true } : {}) });
      if (!isDual) tempArr.push(id);
      save();
      renderTagDropdown(containerId, tempArr, onToggle, compact);
    });
    newInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); addBtn.click(); } });
    newInput.addEventListener('click', e => e.stopPropagation());
  }
}

function startTagEdit(tagId, containerId, tempArr, onToggle, compact) {
  // Pin dropdown open so button clicks don't close it
  openDropdownId = containerId + '-dd';
  const panel = document.getElementById(containerId + '-dd');
  if (!panel) return;
  const tag = getTagById(tagId);
  if (!tag) return;
  const isCustom = customTags.some(t => t.id === tagId);

  const opts = panel.querySelectorAll('.tag-dd-opt');
  opts.forEach(opt => {
    if (opt.dataset.tid === tagId) {
      const cdots = TAG_COLORS.map(c =>
        `<span class="tag-dd-cdot ${c===tag.color?'sel':''}" data-ec="${c}" style="background:${TAG_COLOR_HEX[c]}"></span>`
      ).join('');
      opt.outerHTML = `<div class="tag-edit-row" data-editing="${tagId}">
        <input class="tag-edit-input" value="${tag.label}" id="te-input-${tagId}">
        <div class="tag-dd-color-dots">${cdots}</div>
        <button class="tag-edit-save">OK</button>
        <button class="tag-edit-cancel">X</button>
        ${isCustom ? '<button class="tag-edit-del">Del</button>' : ''}
      </div>`;
    }
  });

  let editColor = tag.color;
  const editRow = panel.querySelector(`[data-editing="${tagId}"]`);
  if (!editRow) return;

  editRow.querySelectorAll('.tag-dd-cdot').forEach(dot => {
    dot.addEventListener('click', e => {
      e.stopPropagation();
      editColor = dot.dataset.ec;
      editRow.querySelectorAll('.tag-dd-cdot').forEach(d => d.classList.remove('sel'));
      dot.classList.add('sel');
    });
  });

  editRow.querySelector('.tag-edit-save').addEventListener('click', e => {
    e.stopPropagation();
    const newLabel = editRow.querySelector('.tag-edit-input').value.trim();
    if (!newLabel) return;
    if (isCustom) {
      const ct = customTags.find(t => t.id === tagId);
      if (ct) { ct.label = newLabel; ct.color = editColor; }
    } else {
      tagOverrides[tagId] = { label: newLabel, color: editColor };
    }
    save(); renderAll(); renderEdges();
    renderTagDropdown(containerId, tempArr, onToggle, compact);
  });

  editRow.querySelector('.tag-edit-cancel').addEventListener('click', e => {
    e.stopPropagation();
    renderTagDropdown(containerId, tempArr, onToggle, compact);
  });

  const delBtn = editRow.querySelector('.tag-edit-del');
  if (delBtn) {
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      customTags = customTags.filter(t => t.id !== tagId);
      const idx = tempArr.indexOf(tagId);
      if (idx >= 0) tempArr.splice(idx, 1);
      doctors.forEach(d => {
        d.tags = (d.tags||[]).filter(t => t !== tagId);
        (d.actions||[]).forEach(a => { a.tags = (a.tags||[]).filter(t => t !== tagId); });
      });
      save(); renderAll(); renderEdges();
      renderTagDropdown(containerId, tempArr, onToggle, compact);
    });
  }

  editRow.querySelector('.tag-edit-input').addEventListener('click', e => e.stopPropagation());
}

// ===== ACTION TYPE DROPDOWN =====
let selectedActionTypeId = null;
let newActionColor = 'blue';
let openActionDropdownId = null;

document.addEventListener('click', e => {
  if (!e.target.closest('.tag-dd-wrap')) {
    if (openDropdownId) {
      openDropdownId = null;
      document.querySelectorAll('.tag-dd-panel.open').forEach(p => p.classList.remove('open'));
    }
    if (openActionDropdownId) {
      openActionDropdownId = null;
      document.querySelectorAll('.tag-dd-panel.open').forEach(p => p.classList.remove('open'));
    }
  }
  // Close toolbar dropdowns when clicking outside
  if (!e.target.closest('.tb-dropdown-wrap')) {
    document.querySelectorAll('.tb-dropdown-wrap.open').forEach(w => w.classList.remove('open'));
  }
});

function renderActionDropdown(containerId) {
  const area = document.getElementById(containerId);
  if (!area) return;
  const types = allActionTypes();

  const bankHtml = types.map(at => {
    const sel = selectedActionTypeId === at.id;
    return `<button class="sb-action-bank-btn ${sel?'selected':''}" data-atid="${at.id}" style="--btn-color:${TAG_COLOR_HEX[at.color]||'#94a3b8'}">${at.label}</button>`;
  }).join('');

  area.innerHTML = `<div class="sb-action-bank-grid">${bankHtml}</div>`;

  area.querySelectorAll('.sb-action-bank-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedActionTypeId = btn.dataset.atid;
      renderActionDropdown(containerId);
    });
  });

  area.querySelectorAll('.tag-dd-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      startActionTypeEdit(btn.dataset.editAtid, containerId);
    });
  });

  area.querySelectorAll('[data-ac]').forEach(dot => {
    dot.addEventListener('click', e => {
      e.stopPropagation();
      newActionColor = dot.dataset.ac;
      renderActionDropdown(containerId);
    });
  });

  const addBtn = area.querySelector(`[data-act-container="${containerId}"]`);
  const newInput = area.querySelector(`#${containerId}-new`);
  if (addBtn && newInput) {
    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      const val = newInput.value.trim(); if (!val) return;
      const id = 'act-custom-' + Date.now();
      customActionTypes.push({ id, label: val, color: newActionColor });
      selectedActionTypeId = id;
      save();
      openActionDropdownId = null;
      renderActionDropdown(containerId);
    });
    newInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.stopPropagation(); addBtn.click(); } });
    newInput.addEventListener('click', e => e.stopPropagation());
  }
}

function startActionTypeEdit(atId, containerId) {
  // Pin dropdown open so button clicks don't close it
  openActionDropdownId = containerId + '-dd';
  const panel = document.getElementById(containerId + '-dd');
  if (!panel) return;
  const at = getActionTypeById(atId);
  if (!at) return;
  const isCustom = customActionTypes.some(t => t.id === atId);

  const opts = panel.querySelectorAll('.tag-dd-opt');
  opts.forEach(opt => {
    if (opt.dataset.atid === atId) {
      const cdots = TAG_COLORS.map(c =>
        `<span class="tag-dd-cdot ${c===at.color?'sel':''}" data-eac="${c}" style="background:${TAG_COLOR_HEX[c]}"></span>`
      ).join('');
      opt.outerHTML = `<div class="tag-edit-row" data-editing-at="${atId}">
        <input class="tag-edit-input" value="${at.label}" id="ate-input-${atId}">
        <div class="tag-dd-color-dots">${cdots}</div>
        <button class="tag-edit-save">OK</button>
        <button class="tag-edit-cancel">X</button>
        ${isCustom ? '<button class="tag-edit-del">Del</button>' : ''}
      </div>`;
    }
  });

  let editColor = at.color;
  const editRow = panel.querySelector(`[data-editing-at="${atId}"]`);
  if (!editRow) return;

  editRow.querySelectorAll('.tag-dd-cdot').forEach(dot => {
    dot.addEventListener('click', e => {
      e.stopPropagation();
      editColor = dot.dataset.eac;
      editRow.querySelectorAll('.tag-dd-cdot').forEach(d => d.classList.remove('sel'));
      dot.classList.add('sel');
    });
  });

  editRow.querySelector('.tag-edit-save').addEventListener('click', e => {
    e.stopPropagation();
    const newLabel = editRow.querySelector('.tag-edit-input').value.trim();
    if (!newLabel) return;
    if (isCustom) {
      const ct = customActionTypes.find(t => t.id === atId);
      if (ct) { ct.label = newLabel; ct.color = editColor; }
    } else {
      actionTypeOverrides[atId] = { label: newLabel, color: editColor };
    }
    save(); renderAll(); renderEdges();
    renderActionDropdown(containerId);
  });

  editRow.querySelector('.tag-edit-cancel').addEventListener('click', e => {
    e.stopPropagation();
    renderActionDropdown(containerId);
  });

  const delBtn = editRow.querySelector('.tag-edit-del');
  if (delBtn) {
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      customActionTypes = customActionTypes.filter(t => t.id !== atId);
      if (selectedActionTypeId === atId) selectedActionTypeId = null;
      save();
      renderActionDropdown(containerId);
    });
  }

  editRow.querySelector('.tag-edit-input').addEventListener('click', e => e.stopPropagation());
}

// ===== PHONE PILLS =====
function renderPhonePills() {
  const area = document.getElementById('sb-phone-pills');
  const textarea = document.getElementById('sb-notes');
  if (!area || !textarea) return;
  const phones = detectPhoneNumbers(textarea.value);
  area.innerHTML = phones.map(p =>
    `<a class="phone-pill" href="tel:${phoneDigits(p)}" onclick="event.stopPropagation()">${p}</a>`
  ).join('');
}

// ===== SIDEBAR =====
function openSidebar() { sidebar.classList.add('open'); }
function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarMode = null; sidebarDocId = null; sidebarParentId = null;
  sidebarNodeDoctors = []; sidebarRefDoctors = []; openDropdownId = null;
}

function openSidebarNew() {
  sidebarMode = 'new'; sidebarDocId = null; sidebarParentId = null;
  sidebarTempTags = []; sidebarTempMisc = [];
  sidebarTempActionTags = []; sidebarTempActionMisc = []; sidebarTempActionLinks = [];
  sidebarTempLinks = [];
  sidebar._pendingActions = [];
  buildSidebar({ name:'',specialty:'',notes:'',tags:[],miscNotes:[],actions:[],links:[],closedOut:false });
  openSidebar();
}

let sidebarRefDoctors = []; // [{name,specialty,notes,tags,miscNotes,links,actions,expanded}]

function openSidebarNewReferral(parentId) {
  sidebarMode = 'referral'; sidebarDocId = null; sidebarParentId = parentId;
  sidebarRefDoctors = [makeEmptyRefDoc(true)];
  openDropdownId = null;
  buildReferralSidebar();
  openSidebar();
}

function makeEmptyRefDoc(expanded) {
  return { name:'', specialty:'', notes:'', tags:[], miscNotes:[], links:[], actions:[], expanded: !!expanded };
}

function buildReferralSidebar() {
  const parent = doctors.find(d => d.id === sidebarParentId);
  const parentName = parent?.name || 'this doctor';

  const entriesHtml = sidebarRefDoctors.map((rd, i) => {
    const exp = rd.expanded ? 'expanded' : '';
    const tagsHtml = rd.tags.map(tid => {
      const tag = getTagById(tid);
      return tag ? `<span class="tag-pill ${tag.color}">${tag.label}<span class="tp-x" data-ref-tag-rm="${i}:${tid}">&times;</span></span>` : '';
    }).join('');

    const actionsHtml = rd.actions.map((a, ai) =>
      `<div class="n-action" style="font-size:11px"><span class="n-action-dot ${a.dotColor||'blue'}"></span>
        <div style="flex:1">${a.date ? `<span style="color:#94a3b8;font-size:10px">${a.date}</span> ` : ''}${a.text}</div>
        <span style="cursor:pointer;color:#cbd5e1;font-size:13px" data-ref-action-rm="${i}:${ai}">&times;</span>
      </div>`
    ).join('');

    const linksHtml = rd.links.map((l, li) =>
      `<div class="sb-link-item"><a href="${l.url}" target="_blank">${l.title||l.url}</a><span class="sb-link-del" data-ref-link-rm="${i}:${li}">&times;</span></div>`
    ).join('');

    return `<div class="ref-entry ${exp}" data-ref-idx="${i}">
      <div class="ref-entry-header" data-ref-toggle="${i}">
        <span class="ref-entry-chevron">\u25B6</span>
        <input type="text" class="ref-entry-name-input" placeholder="Doctor name" value="${rd.name}" data-ref-name="${i}" onclick="event.stopPropagation()">
        <button class="ref-entry-rm" data-ref-rm="${i}" onclick="event.stopPropagation()">&times;</button>
      </div>
      <div class="ref-entry-body">
        <div class="ref-entry-section">
          <div class="ref-entry-label">Specialty</div>
          <input type="text" class="sb-input" placeholder="Cardiology..." value="${rd.specialty}" data-ref-spec="${i}" style="font-size:12px;padding:7px 10px">
        </div>
        <div class="ref-entry-section">
          <div class="ref-entry-label">Notes</div>
          <textarea class="sb-textarea" data-ref-notes="${i}" style="font-size:12px;min-height:36px">${rd.notes}</textarea>
        </div>
        <div class="ref-entry-section">
          <div class="ref-entry-label">Links</div>
          ${linksHtml}
          <div style="display:flex;gap:4px;margin-top:4px">
            <input type="text" class="sb-input" placeholder="Title" data-ref-link-title="${i}" style="flex:1;font-size:11px;padding:5px 8px">
            <input type="text" class="sb-input" placeholder="https://..." data-ref-link-url="${i}" style="flex:2;font-size:11px;padding:5px 8px">
            <button class="tag-dd-add-btn" data-ref-link-add="${i}">+</button>
          </div>
        </div>
        <div class="ref-entry-section">
          <div class="ref-entry-label">Tags</div>
          <div style="display:flex;flex-wrap:wrap;gap:3px">${tagsHtml}</div>
          <div id="ref-tags-${i}"></div>
        </div>
        <div class="ref-entry-section">
          <div class="ref-entry-label">Add Action</div>
          <div style="display:flex;gap:4px">
            <select class="sb-action-select" data-ref-action-type="${i}" style="font-size:11px;padding:6px 8px;flex:1">
              ${ACTION_TYPES.map(t => `<option value="${t.value}">${t.value}</option>`).join('')}
            </select>
            <input type="text" class="sb-input" placeholder="Details..." data-ref-action-detail="${i}" style="font-size:11px;padding:6px 8px;flex:2">
            <button class="tag-dd-add-btn" data-ref-action-add="${i}">+</button>
          </div>
          ${actionsHtml}
        </div>
      </div>
    </div>`;
  }).join('');

  sidebar.innerHTML = `
    <div class="sb-header">
      <div class="sb-title">Referrals from ${parentName}</div>
      <button class="sb-close" onclick="closeSidebar()">&times;</button>
    </div>
    <div class="sb-body">
      <div style="display:flex;flex-direction:column;gap:8px">
        ${entriesHtml}
      </div>
      <button class="node-doc-add" onclick="addRefDoctorEntry()">+ Add another doctor</button>
    </div>
    <div class="sb-footer">
      <div style="flex:1"></div>
      <button class="tb" onclick="closeSidebar()">Cancel</button>
      <button class="sb-save" onclick="saveReferralSidebar()">Add Doctors</button>
    </div>
  `;

  // Render tag dropdowns for each entry
  sidebarRefDoctors.forEach((rd, i) => {
    const area = document.getElementById(`ref-tags-${i}`);
    if (area) {
      renderRefTagDropdown(area, rd.tags, i);
    }
  });

  // Wire events
  // Toggle expand/collapse
  sidebar.querySelectorAll('[data-ref-toggle]').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const idx = parseInt(hdr.dataset.refToggle);
      sidebarRefDoctors[idx].expanded = !sidebarRefDoctors[idx].expanded;
      buildReferralSidebar();
    });
  });

  // Name input
  sidebar.querySelectorAll('[data-ref-name]').forEach(input => {
    input.addEventListener('input', () => {
      sidebarRefDoctors[parseInt(input.dataset.refName)].name = input.value;
    });
  });

  // Specialty input
  sidebar.querySelectorAll('[data-ref-spec]').forEach(input => {
    input.addEventListener('input', () => {
      sidebarRefDoctors[parseInt(input.dataset.refSpec)].specialty = input.value;
    });
  });

  // Notes input
  sidebar.querySelectorAll('[data-ref-notes]').forEach(ta => {
    ta.addEventListener('input', () => {
      sidebarRefDoctors[parseInt(ta.dataset.refNotes)].notes = ta.value;
    });
  });

  // Remove entry
  sidebar.querySelectorAll('[data-ref-rm]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (sidebarRefDoctors.length <= 1) return;
      sidebarRefDoctors.splice(parseInt(btn.dataset.refRm), 1);
      buildReferralSidebar();
    });
  });

  // Add link
  sidebar.querySelectorAll('[data-ref-link-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.refLinkAdd);
      const titleEl = sidebar.querySelector(`[data-ref-link-title="${idx}"]`);
      const urlEl = sidebar.querySelector(`[data-ref-link-url="${idx}"]`);
      let url = urlEl.value.trim(); if (!url) return;
      if (!url.match(/^https?:\/\//)) url = 'https://' + url;
      sidebarRefDoctors[idx].links.push({ title: titleEl.value.trim(), url });
      buildReferralSidebar();
    });
  });

  // Remove link
  sidebar.querySelectorAll('[data-ref-link-rm]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [idx, li] = btn.dataset.refLinkRm.split(':').map(Number);
      sidebarRefDoctors[idx].links.splice(li, 1);
      buildReferralSidebar();
    });
  });

  // Remove tag pill
  sidebar.querySelectorAll('[data-ref-tag-rm]').forEach(x => {
    x.addEventListener('click', e => {
      e.stopPropagation();
      const [idx, tid] = x.dataset.refTagRm.split(':');
      const rd = sidebarRefDoctors[parseInt(idx)];
      rd.tags = rd.tags.filter(t => t !== tid);
      buildReferralSidebar();
    });
  });

  // Add action
  sidebar.querySelectorAll('[data-ref-action-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.refActionAdd);
      const typeEl = sidebar.querySelector(`[data-ref-action-type="${idx}"]`);
      const detailEl = sidebar.querySelector(`[data-ref-action-detail="${idx}"]`);
      const type = typeEl.value;
      const detail = detailEl.value.trim();
      const text = detail ? `${type}: ${detail}` : type;
      const dotColor = (ACTION_TYPES.find(t => t.value === type) || {}).color || 'gray';
      const dateVal = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      sidebarRefDoctors[idx].actions.push({ text, date: dateVal, type: 'action', dotColor, tags: [], miscTags: [] });
      detailEl.value = '';
      buildReferralSidebar();
    });
  });

  // Remove action
  sidebar.querySelectorAll('[data-ref-action-rm]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [idx, ai] = btn.dataset.refActionRm.split(':').map(Number);
      sidebarRefDoctors[idx].actions.splice(ai, 1);
      buildReferralSidebar();
    });
  });
}

function renderRefTagDropdown(area, tagsArr, refIdx) {
  const tags = allTags();
  const ddId = `ref-tags-dd-${refIdx}`;
  const isOpen = openDropdownId === ddId;

  const optsHtml = tags.map(tag => {
    const sel = tagsArr.includes(tag.id);
    return `<div class="tag-dd-opt ${sel ? 'selected' : ''}" data-tid="${tag.id}">
      <span class="tag-dd-dot" style="background:${TAG_COLOR_HEX[tag.color] || '#94a3b8'}"></span>
      <span>${tag.label}</span>
      ${sel ? '<span class="tag-dd-check">\u2713</span>' : ''}
    </div>`;
  }).join('');

  area.innerHTML = `
    <div class="tag-dd-wrap">
      <div class="tag-dd-trigger" data-dd="${ddId}">${tagsArr.length ? tagsArr.length + ' tag' + (tagsArr.length > 1 ? 's' : '') : 'Select tags...'}</div>
      <div class="tag-dd-panel ${isOpen ? 'open' : ''}" id="${ddId}">${optsHtml}</div>
    </div>
  `;

  area.querySelector('.tag-dd-trigger').addEventListener('click', e => {
    e.stopPropagation();
    openDropdownId = isOpen ? null : ddId;
    renderRefTagDropdown(area, tagsArr, refIdx);
  });

  area.querySelectorAll('.tag-dd-opt').forEach(opt => {
    opt.addEventListener('click', e => {
      e.stopPropagation();
      const tid = opt.dataset.tid;
      const idx = tagsArr.indexOf(tid);
      if (idx >= 0) tagsArr.splice(idx, 1); else tagsArr.push(tid);
      buildReferralSidebar();
    });
  });
}

window.addRefDoctorEntry = function() {
  sidebarRefDoctors.push(makeEmptyRefDoc(true));
  buildReferralSidebar();
  setTimeout(() => {
    const inputs = sidebar.querySelectorAll('.ref-entry-name-input');
    inputs[inputs.length - 1]?.focus();
  }, 50);
};

window.saveReferralSidebar = function() {
  const validDocs = sidebarRefDoctors.filter(rd => rd.name.trim());
  if (validDocs.length === 0) { toast('Add at least one doctor name'); return; }

  let count = 0;
  validDocs.forEach(rd => {
    const docNode = {
      id: genId(), name: rd.name.trim(), specialty: rd.specialty.trim(),
      notes: rd.notes.trim(), tags: [...rd.tags], miscNotes: [...(rd.miscNotes || [])],
      links: [...rd.links], actions: [...rd.actions],
      closedOut: false, isNode: false, isPatient: false, isDeactivated: false, addedAt: new Date().toISOString(), documents: [], x: 0, y: 0
    };
    doctors.push(docNode);
    edges.push({ from: sidebarParentId, to: docNode.id, label: '' });
    count++;
  });

  layoutAll(); renderAll(); fitView(); save();
  closeSidebar();
  toast(`${count} doctor${count !== 1 ? 's' : ''} added!`);
};

function openSidebarEdit(id) {
  sidebarMode = 'edit'; sidebarDocId = id; sidebarParentId = null;
  const doc = doctors.find(d => d.id === id);
  if (!doc) return;
  sidebarTempTags = [...(doc.tags||[])];
  sidebarTempMisc = [...(doc.miscNotes||[])];
  sidebarTempLinks = [...(doc.links||[])];
  sidebarTempActionTags = []; sidebarTempActionMisc = []; sidebarTempActionLinks = [];
  openDropdownId = null;
  buildSidebar(doc);
  openSidebar();
}

function buildSidebar(doc, parentDoc) {
  const isEdit = sidebarMode === 'edit';
  const isReferral = sidebarMode === 'referral';
  const title = isEdit ? (doc.name || 'Edit Doctor') : (isReferral ? `Referral from ${parentDoc?.name||'doctor'}` : 'New Doctor');

  let actionLogHtml = '';
  if (isEdit && doc.actions && doc.actions.length > 0) {
    actionLogHtml = `<div class="sb-section">
      <div class="sb-label">Action Log</div>
      <div class="sb-action-log">
        ${doc.actions.map((a,i) => {
          const isClosed = a.type==='closed';
          const at = (a.tags||[]).map(tid=>{const tag=getTagById(tid);return tag?`<span class="n-action-tag">${tag.label}</span>`:''}).concat((a.miscTags||[]).map(m=>`<span class="n-action-tag">${m}</span>`)).join('');
          const alinks = (a.links||[]).map(l=>`<a class="n-link" href="${l.url}" target="_blank" onclick="event.stopPropagation()" style="font-size:10px">${l.title||l.url}</a>`).join('');
          const dotColor = a.dotColor || 'blue';
          return `<div class="sb-action-entry ${isClosed?'closed-entry':''} ${a.type==='patient'?'patient-entry':''}" style="border-left-color:${TAG_COLOR_HEX[dotColor]||'#3b82f6'}">
            <div class="sb-action-entry-text">${a.text}${at?`<div class="sb-action-entry-tags">${at}</div>`:''}${alinks?`<div style="margin-top:3px">${alinks}</div>`:''}</div>
            ${a.date?`<span class="sb-action-entry-date">${a.date}</span>`:''}
            <span class="sb-action-entry-edit" data-action-edit="${i}" title="Edit">✎</span>
            <span class="sb-action-entry-del" data-action-idx="${i}">&times;</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  const linksListHtml = sidebarTempLinks.map((l,i) => `
    <div class="sb-link-item">
      <a href="${l.url}" target="_blank" rel="noopener">${l.title||l.url}</a>
      <span class="sb-link-del" data-link-idx="${i}">&times;</span>
    </div>`).join('');

  const miscListHtml = sidebarTempMisc.map((m,i) =>
    `<span class="n-tag gray" style="cursor:pointer" data-misc-idx="${i}">${m} &times;</span>`
  ).join('');

  // "Refer to existing doctor" search — only in edit mode
  const referExistingHtml = isEdit ? `
    <div class="sb-section">
      <div class="sb-label">Connect to other doctor</div>
      <div class="sb-search-wrap">
        <input type="text" class="sb-input" id="sb-refer-search" placeholder="Search by name..." style="font-size:13px" autocomplete="off">
        <div class="sb-search-results" id="sb-refer-results" style="display:none"></div>
      </div>
    </div>` : '';

  sidebar.innerHTML = `
    <div class="sb-header">
      <input type="text" class="sb-header-name" id="sb-name" value="${doc.name||''}" placeholder="Doctor Name">
      <input type="text" class="sb-header-spec" id="sb-specialty" value="${doc.specialty||''}" placeholder="Specialty">
      <button class="sb-close" onclick="closeSidebar()">&times;</button>
    </div>
    <div class="sb-body">
      <div class="sb-section">
        <div class="sb-label">Notes <span class="sb-label-hint">Phone, address, hours, point of contact</span></div>
        <textarea class="sb-textarea sb-textarea-tall" id="sb-notes">${doc.notes||''}</textarea>
        <div class="phone-pills" id="sb-phone-pills"></div>
      </div>
      <div class="sb-section">
        <div class="sb-label">Links</div>
        <div class="sb-link-list" id="sb-links-list">${linksListHtml}</div>
        <div class="sb-link-row" style="margin-top:6px">
          <input type="text" class="sb-input" id="sb-link-title" placeholder="Title" style="flex:1;font-size:12px;padding:7px 10px">
          <input type="url" class="sb-input" id="sb-link-url" placeholder="https://..." style="flex:2;font-size:12px;padding:7px 10px">
          <button class="tag-dd-add-btn" onclick="addLink()">+</button>
        </div>
      </div>
      <div class="sb-section sb-tags-compact">
        <div id="sb-tags-area"></div>
        <div class="sb-misc-field" id="sb-misc-area">
          <input type="text" class="sb-input" id="sb-misc-input" placeholder="Misc note..." style="font-size:12px">
          <button class="tag-dd-add-btn" onclick="addMiscNote()" style="margin-top:4px">+ Add</button>
          <div id="sb-misc-list" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${miscListHtml}</div>
        </div>
      </div>
      ${referExistingHtml}
      <div class="sb-section">
        <div class="sb-label">Add Action</div>
        <div class="sb-action-box">
          <div class="sb-action-bank" id="sb-action-type-area"></div>
          <input type="text" class="sb-input" id="sb-action-detail" placeholder="Details (optional)" style="font-size:13px">
          <input type="date" class="sb-input" id="sb-action-date" value="${todayISO()}" style="font-size:12px">
          <div style="margin-top:4px">
            <div class="sb-label" style="font-size:10px;margin-bottom:4px">Links</div>
            <div class="sb-link-list" id="sb-action-links-list"></div>
            <div class="sb-link-row" style="margin-top:4px">
              <input type="text" class="sb-input" id="sb-action-link-title" placeholder="Title" style="flex:1;font-size:11px;padding:5px 8px">
              <input type="url" class="sb-input" id="sb-action-link-url" placeholder="https://..." style="flex:2;font-size:11px;padding:5px 8px">
              <button class="tag-dd-add-btn" onclick="addActionLink()">+</button>
            </div>
          </div>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:2px">
            <input type="checkbox" id="sb-action-deactivate" style="width:14px;height:14px;accent-color:#f59e0b">
            <span style="font-size:11px;color:#92400e">De-activate cell <span style="color:#b0a090">(yellow, hidden from Scroll)</span></span>
          </label>
          <button class="sb-action-add-btn" onclick="addAction()">Save Action</button>
        </div>
      </div>
      ${actionLogHtml}
      ${isEdit ? `<div class="sb-section">
        <div class="sb-label">Documents</div>
        <div class="sb-drop-zone" id="sb-drop-zone">
          <div style="font-size:20px;margin-bottom:4px">📄</div>
          Drag & drop or <span style="color:#3b82f6;cursor:pointer" onclick="document.getElementById('sb-doc-input').click()">browse</span>
        </div>
        <input type="file" id="sb-doc-input" style="display:none" onchange="handleDocSelect(event)">
        <div id="sb-doc-list" style="display:flex;flex-direction:column;gap:4px;margin-top:6px">
          ${(doc.documents||[]).map((dc,i) => `
            <div class="sb-doc-entry">
              <div class="sb-doc-thumb">${dc.preview ? `<img src="${dc.preview}" style="width:32px;height:32px;object-fit:cover;border-radius:4px">` : '📄'}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:500;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${dc.filename}</div>
                <div style="font-size:10px;color:#94a3b8">${dc.dateAdded || ''} · ${dc.size ? Math.round(dc.size/1024)+'KB' : ''}</div>
                ${dc.savedPath ? `<div style="font-size:10px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${dc.savedPath}">📂 ${dc.savedPath}</div>` : ''}
              </div>
              <span style="cursor:pointer;color:#cbd5e1;font-size:14px" onclick="removeDocument(${i})">&times;</span>
            </div>
          `).join('')}
        </div>
      </div>` : ''}
      <div class="sb-section" style="border-bottom:none;display:flex;flex-direction:column;gap:10px">
        ${isEdit && !doc.closedOut && !doc.isPatient ? `
          <div class="sb-patient-box">
            <div class="sb-label" style="color:#166534;margin-bottom:6px">🏥 Now a Patient</div>
            <input type="text" class="sb-input sb-patient-input" id="sb-patient-reason" placeholder="e.g. First appointment scheduled, accepted as patient...">
            <button class="sb-now-patient" onclick="markAsPatient()">Mark as Patient</button>
          </div>` : ''}
        ${isEdit && doc.isPatient ? '<button class="sb-reopen" onclick="undoPatient()" style="border-color:#86efac;background:#f0fdf4;color:#166534">Undo Patient Status</button>' : ''}
        ${isEdit && doc.isDeactivated ? '<button class="sb-reopen" onclick="reactivateDoctor()" style="border-color:#fcd34d;background:#fefce8;color:#92400e">Re-activate this doctor</button>' : ''}
        ${isEdit && !doc.closedOut ? `
          <div class="sb-dealbreaker-box">
            <div class="sb-label" style="color:#dc2626;margin-bottom:6px">⛔ Dealbreaker</div>
            <input type="text" class="sb-input sb-dealbreaker-input" id="sb-dealbreaker-reason" placeholder="e.g. Won't see me, don't like their attitude...">
            <button class="sb-close-out" onclick="closeOutDoctor()">Mark as Dealbreaker</button>
          </div>` : ''}
        ${isEdit && doc.closedOut ? '<button class="sb-reopen" onclick="reopenDoctor()">Reopen this doctor</button>' : ''}
        <div style="padding:4px 0">
          <label class="sb-toggle-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="sb-is-node" ${doc.isNode?'checked':''} style="width:16px;height:16px;accent-color:#8b5cf6">
            <span style="font-size:13px;color:#475569">This is a <strong style="color:#7c3aed">Node</strong> (organization, source, person — not a doctor)</span>
          </label>
        </div>
      </div>
    </div>
    <div class="sb-footer">
      ${isEdit ? `<button class="sb-delete" onclick="deleteDoctor()">Delete</button>
      <button class="tb" onclick="closeSidebar();openSidebarNewReferral(${doc.id||sidebarDocId})" style="background:#eff6ff;border-color:#93c5fd;color:#1e40af;font-weight:600">Referred to other doctor</button>` : ''}
      <div style="flex:1"></div>
      <button class="tb" onclick="closeSidebar()">Cancel</button>
      <button class="sb-save" onclick="saveSidebar()">${isEdit ? 'Save' : 'Add Doctor'}</button>
    </div>
  `;

  renderTagDropdown('sb-tags-area', sidebarTempTags);
  selectedActionTypeId = null;
  renderActionDropdown('sb-action-type-area');
  renderPhonePills();
  renderActionLinksList();
  document.getElementById('sb-notes')?.addEventListener('input', renderPhonePills);

  // Wire drag-drop for documents
  const dropZone = document.getElementById('sb-drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = '#3b82f6'; dropZone.style.background = '#eff6ff'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = ''; dropZone.style.background = ''; });
    dropZone.addEventListener('drop', e => {
      e.preventDefault(); dropZone.style.borderColor = ''; dropZone.style.background = '';
      if (e.dataTransfer.files.length > 0) processDocUpload(e.dataTransfer.files[0]);
    });
  }

  sidebar.querySelectorAll('.sb-link-del').forEach(btn => {
    btn.addEventListener('click', () => { sidebarTempLinks.splice(parseInt(btn.dataset.linkIdx), 1); renderLinksList(); });
  });
  sidebar.querySelectorAll('[data-misc-idx]').forEach(tag => {
    tag.addEventListener('click', () => { sidebarTempMisc.splice(parseInt(tag.dataset.miscIdx), 1); renderMiscList(); });
  });
  sidebar.querySelectorAll('.sb-action-entry-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = doctors.find(d => d.id === sidebarDocId);
      if (d && d.actions) {
        const sbBody = sidebar.querySelector('.sb-body');
        const scrollPos = sbBody ? sbBody.scrollTop : 0;
        d.actions.splice(parseInt(btn.dataset.actionIdx), 1);
        save(); renderNode(d); renderEdges(); buildSidebar(d);
        requestAnimationFrame(() => {
          const newBody = sidebar.querySelector('.sb-body');
          if (newBody) newBody.scrollTop = scrollPos;
        });
      }
    });
  });

  // Action edit buttons
  sidebar.querySelectorAll('.sb-action-entry-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.actionEdit);
      const d = doctors.find(d => d.id === sidebarDocId);
      if (!d || !d.actions || !d.actions[idx]) return;
      startActionEntryEdit(idx, btn.closest('.sb-action-entry'), d);
    });
  });

  document.getElementById('sb-link-url')?.addEventListener('keydown', e => { if(e.key==='Enter') addLink(); });
  document.getElementById('sb-action-detail')?.addEventListener('keydown', e => { if(e.key==='Enter') addAction(); });

  // Refer to existing doctor search
  const searchInput = document.getElementById('sb-refer-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.trim().toLowerCase();
      const resultsEl = document.getElementById('sb-refer-results');
      if (!query) { resultsEl.style.display = 'none'; return; }
      const matches = doctors.filter(d =>
        d.id !== sidebarDocId &&
        d.name.toLowerCase().includes(query) &&
        !edges.some(e => e.from === sidebarDocId && e.to === d.id)
      ).slice(0, 8);
      if (matches.length === 0) { resultsEl.style.display = 'none'; return; }
      resultsEl.style.display = 'block';
      resultsEl.innerHTML = matches.map(d => `
        <div class="sb-search-result" data-connect-id="${d.id}">
          <span class="sb-search-result-name">${d.name}</span>
          ${d.specialty ? `<span class="sb-search-result-spec">${d.specialty}</span>` : ''}
        </div>
      `).join('');
      resultsEl.querySelectorAll('.sb-search-result').forEach(r => {
        r.addEventListener('click', () => {
          const toId = parseInt(r.dataset.connectId);
          edges.push({ from: sidebarDocId, to: toId, label: '' });
          layoutAll(); renderAll(); fitView(); save();
          searchInput.value = '';
          resultsEl.style.display = 'none';
          toast(`Connected to ${doctors.find(d=>d.id===toId)?.name}!`);
        });
      });
    });
  }
}

function renderLinksList() {
  const list = document.getElementById('sb-links-list');
  if (!list) return;
  list.innerHTML = sidebarTempLinks.map((l,i) => `
    <div class="sb-link-item">
      <a href="${l.url}" target="_blank" rel="noopener">${l.title||l.url}</a>
      <span class="sb-link-del" data-link-idx="${i}">&times;</span>
    </div>`).join('');
  list.querySelectorAll('.sb-link-del').forEach(btn => {
    btn.addEventListener('click', () => { sidebarTempLinks.splice(parseInt(btn.dataset.linkIdx), 1); renderLinksList(); });
  });
}

function renderMiscList() {
  const list = document.getElementById('sb-misc-list');
  if (!list) return;
  list.innerHTML = sidebarTempMisc.map((m,i) =>
    `<span class="n-tag gray" style="cursor:pointer" data-misc-idx="${i}">${m} &times;</span>`
  ).join('');
  list.querySelectorAll('[data-misc-idx]').forEach(tag => {
    tag.addEventListener('click', () => { sidebarTempMisc.splice(parseInt(tag.dataset.miscIdx), 1); renderMiscList(); });
  });
}

window.addLink = function() {
  const titleEl=document.getElementById('sb-link-title'), urlEl=document.getElementById('sb-link-url');
  let url=urlEl.value.trim(); if(!url) return;
  if(!url.match(/^https?:\/\//)) url='https://'+url;
  sidebarTempLinks.push({title:titleEl.value.trim()||'',url});
  titleEl.value=''; urlEl.value='';
  renderLinksList();
};

window.addMiscNote = function() {
  const input=document.getElementById('sb-misc-input');
  const val=input.value.trim(); if(!val) return;
  sidebarTempMisc.push(val); input.value='';
  renderMiscList();
};

window.addAction = function() {
  const detailEl=document.getElementById('sb-action-detail');
  const dateEl=document.getElementById('sb-action-date');

  const actionType = selectedActionTypeId ? getActionTypeById(selectedActionTypeId) : null;
  if (!actionType) { toast('Select an action type'); return; }
  const type = actionType.label;
  const detail=detailEl.value.trim();
  const dateVal=dateEl.value ? new Date(dateEl.value+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
  const text = detail ? `${type}: ${detail}` : type;
  const dotColor = actionType.color || 'gray';

  const action = { text, date:dateVal, type:'action', dotColor, tags:[...sidebarTempActionTags], miscTags:[...sidebarTempActionMisc], links:[...sidebarTempActionLinks] };

  // Check deactivate checkbox
  const deactivateChecked = document.getElementById('sb-action-deactivate')?.checked || false;

  if (sidebarMode==='edit' && sidebarDocId) {
    const d=doctors.find(d=>d.id===sidebarDocId);
    if(d) {
      if(!d.actions) d.actions=[];
      d.actions.push(action);
      if (deactivateChecked) {
        d.isDeactivated = true;
        d.actions.push({ text: 'De-activated', date: todayStr(), type: 'deactivated', dotColor: 'amber', tags: [], miscTags: [], links: [] });
      }
      save(); renderNode(d); renderEdges(); buildSidebar(d);
    }
  } else {
    if(!sidebar._pendingActions) sidebar._pendingActions=[];
    sidebar._pendingActions.push(action);
    toast('Action queued');
  }
  detailEl.value='';
  sidebarTempActionTags=[]; sidebarTempActionMisc=[]; sidebarTempActionLinks=[];
  renderTagDropdown('sb-action-tags-area', sidebarTempActionTags, null, true);
  renderActionLinksList();
};

// ===== EDIT ACTION IN-PLACE =====
function startActionEntryEdit(idx, entryEl, doc) {
  const action = doc.actions[idx];
  if (!action) return;
  const currentColor = action.dotColor || 'blue';

  const colorDots = TAG_COLORS.map(c =>
    `<span class="ae-color-dot ${c===currentColor?'sel':''}" data-aec="${c}" style="background:${TAG_COLOR_HEX[c]};width:16px;height:16px;border-radius:50%;display:inline-block;cursor:pointer;border:2px solid ${c===currentColor?'#1e293b':'transparent'};transition:all 0.1s"></span>`
  ).join('');

  entryEl.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:6px;width:100%">
      <input type="text" class="sb-input ae-text-input" value="${action.text.replace(/"/g,'&quot;')}" style="font-size:12px;padding:6px 8px">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:10px;color:#94a3b8;white-space:nowrap">Color:</span>
        <div style="display:flex;gap:3px;flex-wrap:wrap">${colorDots}</div>
      </div>
      <div style="display:flex;gap:4px;justify-content:flex-end">
        <button class="ae-cancel" style="padding:4px 10px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;cursor:pointer;font-size:11px;font-family:inherit">Cancel</button>
        <button class="ae-save" style="padding:4px 10px;border-radius:6px;border:none;background:#3b82f6;color:white;cursor:pointer;font-size:11px;font-weight:600;font-family:inherit">Save</button>
      </div>
    </div>
  `;
  entryEl.style.borderLeftColor = TAG_COLOR_HEX[currentColor] || '#3b82f6';

  let editColor = currentColor;
  const textInput = entryEl.querySelector('.ae-text-input');
  textInput.focus();
  textInput.select();

  // Color dot clicks
  entryEl.querySelectorAll('.ae-color-dot').forEach(dot => {
    dot.addEventListener('click', e => {
      e.stopPropagation();
      editColor = dot.dataset.aec;
      entryEl.querySelectorAll('.ae-color-dot').forEach(d => {
        d.style.borderColor = d.dataset.aec === editColor ? '#1e293b' : 'transparent';
      });
      entryEl.style.borderLeftColor = TAG_COLOR_HEX[editColor] || '#3b82f6';
    });
  });

  // Save
  entryEl.querySelector('.ae-save').addEventListener('click', e => {
    e.stopPropagation();
    const newText = textInput.value.trim();
    if (!newText) { toast('Enter action text'); textInput.focus(); return; }
    action.text = newText;
    action.dotColor = editColor;
    save(); renderNode(doc); renderEdges(); buildSidebar(doc);
    toast('Action updated');
  });

  // Cancel
  entryEl.querySelector('.ae-cancel').addEventListener('click', e => {
    e.stopPropagation();
    buildSidebar(doc);
  });

  // Enter to save
  textInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); entryEl.querySelector('.ae-save').click(); }
    if (e.key === 'Escape') { e.preventDefault(); entryEl.querySelector('.ae-cancel').click(); }
  });
}

window.addActionLink = function() {
  const titleEl=document.getElementById('sb-action-link-title'), urlEl=document.getElementById('sb-action-link-url');
  let url=urlEl.value.trim(); if(!url) return;
  if(!url.match(/^https?:\/\//)) url='https://'+url;
  sidebarTempActionLinks.push({title:titleEl.value.trim()||'',url});
  titleEl.value=''; urlEl.value='';
  renderActionLinksList();
};

function renderActionLinksList() {
  const list = document.getElementById('sb-action-links-list');
  if (!list) return;
  list.innerHTML = sidebarTempActionLinks.map((l,i) => `
    <div class="sb-link-item">
      <a href="${l.url}" target="_blank" rel="noopener">${l.title||l.url}</a>
      <span class="sb-link-del" data-alink-idx="${i}">&times;</span>
    </div>`).join('');
  list.querySelectorAll('[data-alink-idx]').forEach(btn => {
    btn.addEventListener('click', () => { sidebarTempActionLinks.splice(parseInt(btn.dataset.alinkIdx), 1); renderActionLinksList(); });
  });
}

window.closeOutDoctor = function() {
  if(!sidebarDocId) return;
  const d=doctors.find(d=>d.id===sidebarDocId); if(!d) return;
  const reasonEl = document.getElementById('sb-dealbreaker-reason');
  const reason = reasonEl ? reasonEl.value.trim() : '';
  if (!reason) { toast('Enter a reason for the dealbreaker'); reasonEl?.focus(); return; }
  d.closedOut=true;
  if(!d.actions) d.actions=[];
  d.actions.push({text:`Dealbreaker: ${reason}`,date:todayStr(),type:'closed',dotColor:'red',tags:[],miscTags:[]});
  save(); renderNode(d); renderEdges(); buildSidebar(d);
};

window.reopenDoctor = function() {
  if(!sidebarDocId) return;
  const d=doctors.find(d=>d.id===sidebarDocId); if(!d) return;
  d.closedOut=false; save(); renderNode(d); renderEdges(); buildSidebar(d);
};

window.markAsPatient = function() {
  if(!sidebarDocId) return;
  const d=doctors.find(d=>d.id===sidebarDocId); if(!d) return;
  const reasonEl = document.getElementById('sb-patient-reason');
  const reason = reasonEl ? reasonEl.value.trim() : '';
  d.isPatient=true;
  if(!d.actions) d.actions=[];
  const text = reason ? `Now a Patient: ${reason}` : 'Now a Patient';
  d.actions.push({text,date:todayStr(),type:'patient',dotColor:'green',tags:[],miscTags:[],links:[]});
  save(); renderNode(d); renderEdges(); buildSidebar(d);
  toast(`${d.name} marked as patient!`);
};

window.undoPatient = function() {
  if(!sidebarDocId) return;
  const d=doctors.find(d=>d.id===sidebarDocId); if(!d) return;
  d.isPatient=false; save(); renderNode(d); renderEdges(); buildSidebar(d);
};

window.reactivateDoctor = function() {
  if(!sidebarDocId) return;
  const d=doctors.find(d=>d.id===sidebarDocId); if(!d) return;
  d.isDeactivated=false;
  if(!d.actions) d.actions=[];
  d.actions.push({ text:'Re-activated', date:todayStr(), type:'action', dotColor:'green', tags:[], miscTags:[], links:[] });
  save(); renderNode(d); renderEdges(); buildSidebar(d);
  toast(`${d.name} re-activated!`);
};

// ===== DOCUMENT HANDLING =====
window.handleDocSelect = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  processDocUpload(file);
  event.target.value = '';
};

function processDocUpload(file) {
  if (!sidebarDocId) return;
  const d = doctors.find(d => d.id === sidebarDocId);
  if (!d) return;
  if (!d.documents) d.documents = [];

  const reader = new FileReader();
  reader.onload = function(e) {
    const data = e.target.result;
    let preview = null;

    // Generate preview for images
    if (file.type.startsWith('image/')) {
      // Create thumbnail
      const img = new Image();
      img.onload = function() {
        const canvas = document.createElement('canvas');
        const maxSize = 80;
        const scale = Math.min(maxSize / img.width, maxSize / img.height);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        preview = canvas.toDataURL('image/jpeg', 0.6);
        finishDocUpload(d, file, preview, data);
      };
      img.src = data;
    } else {
      finishDocUpload(d, file, null, data);
    }
  };
  reader.readAsDataURL(file);
}

function finishDocUpload(doc, file, preview, dataUrl) {
  const docMeta = {
    id: 'doc-' + Date.now(),
    filename: file.name,
    dateAdded: todayStr(),
    tags: [],
    preview: preview,
    savedPath: '',
    size: file.size
  };
  doc.documents.push(docMeta);

  // Add action log entry
  if (!doc.actions) doc.actions = [];
  doc.actions.push({
    text: `Document: ${file.name}`,
    date: todayStr(), type: 'action', dotColor: 'teal',
    tags: [], miscTags: [], links: []
  });

  // Trigger download so user can save to their folder
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = file.name;
  a.click();

  // Prompt for save path
  const savedPath = prompt(`File "${file.name}" downloaded.\n\nEnter the folder path where you saved it (e.g., ~/Documents/Medical):`, '~/Documents/Medical');
  if (savedPath) {
    docMeta.savedPath = savedPath + '/' + file.name;
  }

  save(); renderNode(doc); renderEdges(); buildSidebar(doc);
  toast(`Document "${file.name}" added!`);
}

window.removeDocument = function(idx) {
  if (!sidebarDocId) return;
  const d = doctors.find(d => d.id === sidebarDocId);
  if (!d || !d.documents) return;
  d.documents.splice(idx, 1);
  save(); renderNode(d); renderEdges(); buildSidebar(d);
};

window.deleteDoctor = function() {
  if(!sidebarDocId) return;
  const d=doctors.find(d=>d.id===sidebarDocId);
  if(!confirm(`Remove ${d?.name||'this doctor'}?`)) return;
  doctors=doctors.filter(d=>d.id!==sidebarDocId);
  edges=edges.filter(e=>e.from!==sidebarDocId&&e.to!==sidebarDocId);
  document.getElementById('node-'+sidebarDocId)?.remove();
  closeSidebar(); layoutAll(); renderAll(); save();
};

window.saveSidebar = function() {
  const name=document.getElementById('sb-name').value.trim();
  const specialty=document.getElementById('sb-specialty').value.trim();
  const notes=document.getElementById('sb-notes').value.trim();
  if(!name) { toast('Please enter a doctor name'); document.getElementById('sb-name').focus(); return; }

  const isNodeChecked = document.getElementById('sb-is-node')?.checked || false;

  if(sidebarMode==='edit') {
    const d=doctors.find(d=>d.id===sidebarDocId); if(!d) return;
    d.name=name; d.specialty=specialty; d.notes=notes; d.isNode=isNodeChecked;
    d.tags=[...sidebarTempTags]; d.miscNotes=[...sidebarTempMisc]; d.links=[...sidebarTempLinks];
    save(); renderNode(d); renderEdges(); closeSidebar(); toast('Saved!');
  } else {
    const d = { id:genId(), name, specialty, notes, tags:[...sidebarTempTags], miscNotes:[...sidebarTempMisc],
      links:[...sidebarTempLinks], actions:sidebar._pendingActions||[], closedOut:false,
      isNode:false, isPatient:false, isDeactivated:false, addedAt:new Date().toISOString(), documents:[], x:0, y:0 };
    doctors.push(d);
    if(sidebarMode==='referral'&&sidebarParentId) edges.push({from:sidebarParentId,to:d.id,label:''});
    sidebar._pendingActions=[];
    layoutAll(); renderAll(); fitView(); save(); closeSidebar(); toast(`${name} added!`);
  }
};

// ===== ADD NODE SIDEBAR =====
window.openSidebarAddNode = function() {
  sidebarMode = 'addnode'; sidebarDocId = null; sidebarParentId = null;
  sidebarNodeDoctors = [{ name: '', link: '' }];
  openDropdownId = null;
  buildNodeSidebar();
  openSidebar();
};

function buildNodeSidebar() {
  const rowsHtml = sidebarNodeDoctors.map((d, i) => `
    <div class="node-doc-row">
      <input type="text" class="sb-input" placeholder="Doctor name" value="${d.name}" data-nd-idx="${i}" data-nd-field="name" style="font-size:13px">
      <input type="text" class="sb-input" placeholder="Link (optional)" value="${d.link}" data-nd-idx="${i}" data-nd-field="link" style="font-size:12px;flex:0.7">
      <button class="node-doc-rm" data-nd-rm="${i}">&times;</button>
    </div>
  `).join('');

  sidebar.innerHTML = `
    <div class="sb-header">
      <div class="sb-title">Add Node</div>
      <button class="sb-close" onclick="closeSidebar()">&times;</button>
    </div>
    <div class="sb-body">
      <div class="sb-section">
        <div class="sb-label">Person Name</div>
        <input type="text" class="sb-input" id="sbn-person" placeholder="Mom, Friend, Colleague..." style="font-size:15px;font-weight:600">
      </div>
      <div class="sb-section">
        <div class="sb-label">Doctors they recommended <span class="sb-label-hint">These become nodes you can edit later</span></div>
        <div id="sbn-doctors" style="display:flex;flex-direction:column;gap:6px">
          ${rowsHtml}
        </div>
        <button class="node-doc-add" onclick="addNodeDoctorRow()">+ Add another doctor</button>
      </div>
    </div>
    <div class="sb-footer">
      <div style="flex:1"></div>
      <button class="tb" onclick="closeSidebar()">Cancel</button>
      <button class="sb-save" onclick="saveNodeSidebar()">Done</button>
    </div>
  `;

  sidebar.querySelectorAll('[data-nd-idx]').forEach(input => {
    input.addEventListener('input', () => {
      const idx = parseInt(input.dataset.ndIdx);
      sidebarNodeDoctors[idx][input.dataset.ndField] = input.value;
    });
  });

  sidebar.querySelectorAll('[data-nd-rm]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (sidebarNodeDoctors.length <= 1) return;
      sidebarNodeDoctors.splice(parseInt(btn.dataset.ndRm), 1);
      buildNodeSidebar();
    });
  });
}

window.addNodeDoctorRow = function() {
  // Preserve person name before rebuild
  const personInput = document.getElementById('sbn-person');
  const savedPersonName = personInput ? personInput.value : '';
  sidebarNodeDoctors.push({ name: '', link: '' });
  buildNodeSidebar();
  const restored = document.getElementById('sbn-person');
  if (restored) restored.value = savedPersonName;
  setTimeout(() => {
    const inputs = sidebar.querySelectorAll('[data-nd-field="name"]');
    inputs[inputs.length - 1]?.focus();
  }, 50);
};

window.saveNodeSidebar = function() {
  const personName = document.getElementById('sbn-person').value.trim();
  if (!personName) { toast('Enter a person name'); document.getElementById('sbn-person').focus(); return; }

  const personNode = { id:genId(), name:personName, specialty:'', notes:'', tags:[], miscNotes:[], actions:[], links:[], closedOut:false, isNode:true, isPatient:false, isDeactivated:false, addedAt:new Date().toISOString(), documents:[], x:0, y:0 };
  doctors.push(personNode);

  let count = 0;
  sidebarNodeDoctors.forEach(d => {
    const dName = d.name.trim();
    if (!dName) return;
    const links = d.link.trim() ? [{ title: '', url: d.link.trim().match(/^https?:\/\//) ? d.link.trim() : 'https://' + d.link.trim() }] : [];
    const docNode = { id:genId(), name:dName, specialty:'', notes:'', tags:[], miscNotes:[], actions:[], links, closedOut:false, isNode:false, isPatient:false, isDeactivated:false, addedAt:new Date().toISOString(), documents:[], x:0, y:0 };
    doctors.push(docNode);
    edges.push({ from: personNode.id, to: docNode.id, label: '' });
    count++;
  });

  layoutAll(); renderAll(); fitView(); save();
  closeSidebar();
  toast(`${personName} added with ${count} doctor${count!==1?'s':''}!`);
};

// ===== NODE DRAGGING =====
let draggingNode = null;   // { doc, el, startX, startY, origX, origY, moved }
let dragThreshold = 5;     // pixels before drag activates

function startNodeDrag(doc, el, e) {
  e.stopPropagation();
  draggingNode = {
    doc, el,
    startX: e.clientX,
    startY: e.clientY,
    origX: doc.x,
    origY: doc.y,
    moved: false
  };
}

window.addEventListener('mousemove', e => {
  if (!draggingNode) return;
  const dx = e.clientX - draggingNode.startX;
  const dy = e.clientY - draggingNode.startY;
  if (!draggingNode.moved && Math.abs(dx) + Math.abs(dy) < dragThreshold) return;
  draggingNode.moved = true;
  draggingNode.doc.x = draggingNode.origX + dx / zoom;
  draggingNode.doc.y = draggingNode.origY + dy / zoom;
  draggingNode.el.style.left = draggingNode.doc.x + 'px';
  draggingNode.el.style.top = draggingNode.doc.y + 'px';
  renderEdges();
});

window.addEventListener('mouseup', () => {
  if (draggingNode && draggingNode.moved) {
    save();
  }
  draggingNode = null;
});

// ===== PAN & ZOOM EVENTS =====
canvas.addEventListener('mousedown', e => {
  if(e.target===canvas||e.target===world||e.target===svg) {
    if (connectingFrom !== null) { cancelConnect(); return; }
    isPanning=true; panStart.x=e.clientX-pan.x; panStart.y=e.clientY-pan.y;
    canvas.classList.add('dragging');
  }
});
window.addEventListener('mousemove', e => {
  if(isPanning) { pan.x=e.clientX-panStart.x; pan.y=e.clientY-panStart.y; clampPan(); updateTransform(); }
});
window.addEventListener('mouseup', () => { if(isPanning) { isPanning=false; canvas.classList.remove('dragging'); } });
canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.deltaY>0?0.92:1.08, e.clientX, e.clientY); }, {passive:false});

function zoomAt(factor, cx, cy) {
  const minZoom=getFitZoom();
  const nz=Math.min(2.5, Math.max(minZoom, zoom*factor));
  if(nz===zoom) return;
  const r=canvas.getBoundingClientRect();
  const mx=cx-r.left, my=cy-r.top;
  pan.x=mx-(mx-pan.x)*(nz/zoom); pan.y=my-(my-pan.y)*(nz/zoom);
  zoom=nz; clampPan(); updateTransform();
}
window.zoomBy = function(f) { const r=canvas.getBoundingClientRect(); zoomAt(f, r.left+r.width/2, r.top+r.height/2); };
window.fitView = function() {
  const b=getWorldBounds(); if(!b) return;
  const cw=canvas.clientWidth, ch=canvas.clientHeight, pad=60;
  const ww=b.maxX-b.minX+pad*2, wh=b.maxY-b.minY+pad*2;
  zoom=Math.min(2, Math.max(0.3, Math.min(cw/ww, ch/wh)));
  pan.x=(cw-ww*zoom)/2-(b.minX-pad)*zoom;
  pan.y=(ch-wh*zoom)/2-(b.minY-pad)*zoom;
  updateTransform();
};

// ===== COMMENT MODE =====
let commentSystemInitialized = false;
window.toggleCommentMode = function(on) {
  document.getElementById('comment-system-css').disabled = !on;
  document.body.classList.toggle('comment-mode', on);
  if (on && !commentSystemInitialized && typeof CommentSystem !== 'undefined') {
    CommentSystem.init({
      storageKey: 'doctor-network-comments',
      navbarHeight: 50,
      tabSelector: null,
    });
    commentSystemInitialized = true;
  }
};

// ===== DEBUG =====
window.toggleDebug = function() { document.getElementById('debug-output').classList.toggle('open'); };
window.debugDumpState = function() {
  const state = {
    doctorCount:doctors.length, edgeCount:edges.length, customTagCount:customTags.length,
    tagOverrides, zoom:Math.round(zoom*100)+'%', pan:{x:Math.round(pan.x),y:Math.round(pan.y)},
    doctors:doctors.map(d=>({id:d.id,name:d.name,specialty:d.specialty,closedOut:d.closedOut,
      tagCount:(d.tags||[]).length,actionCount:(d.actions||[]).length,linkCount:(d.links||[]).length,
      pos:{x:Math.round(d.x),y:Math.round(d.y)}})),
    edges:edges.map(e=>{const f=doctors.find(d=>d.id===e.from),t=doctors.find(d=>d.id===e.to);
      return {from:f?.name||e.from,to:t?.name||e.to,label:e.label};}),
    customTags, customActionTypes, actionTypeOverrides, sidebarOpen:sidebar.classList.contains('open'), sidebarMode, sidebarDocId,
    localStorageSize:Math.round((localStorage.getItem('doctor-network')||'').length/1024)+'KB'
  };
  document.getElementById('debug-content').textContent=JSON.stringify(state,null,2);
};
window.debugDumpDOM = function() {
  const nodes=document.querySelectorAll('.doctor-node');
  let o=`=== DOM Dump ===\nNodes: ${nodes.length}\n\n`;
  nodes.forEach(n=>{const r=n.getBoundingClientRect();
    o+=`#${n.id}: ${Math.round(r.width)}x${Math.round(r.height)} at (${Math.round(r.left)},${Math.round(r.top)})\n`;
    o+=`  classes: ${n.className}\n  left: ${n.style.left}, top: ${n.style.top}\n\n`;
  });
  o+=`SVG paths: ${svg.querySelectorAll('path').length}\nCanvas: ${canvas.clientWidth}x${canvas.clientHeight}\nTransform: ${world.style.transform}\n`;
  document.getElementById('debug-content').textContent=o;
};
window.debugCopyAll = function() {
  if(!document.getElementById('debug-content').textContent) debugDumpState();
  navigator.clipboard.writeText(document.getElementById('debug-content').textContent).then(()=>toast('Copied!'));
};
window.debugClear = function() { document.getElementById('debug-content').textContent=''; };

// ===== PERSISTENCE =====
function save() {
  localStorage.setItem('doctor-network', JSON.stringify({doctors,edges,nextId,customTags,tagOverrides,customActionTypes,actionTypeOverrides,globalNotes,viewMode}));
  showAutosave();
}
function load() {
  const raw=localStorage.getItem('doctor-network'); if(!raw) return;
  try {
    const data=JSON.parse(raw);
    doctors=data.doctors||[]; edges=data.edges||[]; nextId=data.nextId||1;
    customTags=data.customTags||[]; tagOverrides=data.tagOverrides||{};
    customActionTypes=data.customActionTypes||[]; actionTypeOverrides=data.actionTypeOverrides||{};
    globalNotes=data.globalNotes||'';
    viewMode=data.viewMode||'nucleus';
    // Migrate: add new fields to existing doctors
    const allTargeted = new Set((data.edges||[]).map(e => e.to));
    doctors.forEach(d => {
      if (d.addedAt === undefined) d.addedAt = new Date().toISOString();
      if (d.isNode === undefined) {
        // Top-level parents (no incoming edges but have outgoing) default to node
        const hasOutgoing = (data.edges||[]).some(e => e.from === d.id);
        d.isNode = !allTargeted.has(d.id) && hasOutgoing;
      }
      if (d.isPatient === undefined) d.isPatient = false;
      if (d.isDeactivated === undefined) d.isDeactivated = false;
      if (d.documents === undefined) d.documents = [];
      (d.actions || []).forEach(a => { if (!a.links) a.links = []; });
      // Migrate old tag IDs to dual-mode format
      if (d.tags) {
        d.tags = d.tags.map(t => {
          if (t === 'ins-yes') return 'insurance:yes';
          if (t === 'ins-no') return 'insurance:no';
          return t;
        });
      }
    });
    document.getElementById('notes-textarea').value=globalNotes;
    // Update view mode radio UI
    document.querySelectorAll('.tb-view-opt').forEach(el => el.classList.remove('active'));
    const activeViewBtn = document.getElementById('view-' + viewMode);
    if (activeViewBtn) activeViewBtn.classList.add('active');
    renderAll(); fitView();
  } catch(e) { console.error('Load error:',e); }
}
function exportData() {
  const data=JSON.stringify({doctors,edges,nextId,customTags,tagOverrides,customActionTypes,actionTypeOverrides,globalNotes,viewMode},null,2);
  const blob=new Blob([data],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='doctor-network.json'; a.click();
  URL.revokeObjectURL(url); toast('Exported!');
}
function importData(event) {
  const file=event.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    try {
      const data=JSON.parse(e.target.result);
      world.querySelectorAll('.doctor-node').forEach(el=>el.remove());
      doctors=data.doctors||[]; edges=data.edges||[]; nextId=data.nextId||1;
      customTags=data.customTags||[]; tagOverrides=data.tagOverrides||{};
      customActionTypes=data.customActionTypes||[]; actionTypeOverrides=data.actionTypeOverrides||{};
      globalNotes=data.globalNotes||'';
      viewMode=data.viewMode||'nucleus';
      doctors.forEach(d => {
        if (d.addedAt === undefined) d.addedAt = new Date().toISOString();
        if (d.isNode === undefined) d.isNode = false;
        if (d.isPatient === undefined) d.isPatient = false;
        if (d.isDeactivated === undefined) d.isDeactivated = false;
        if (d.documents === undefined) d.documents = [];
        (d.actions || []).forEach(a => { if (!a.links) a.links = []; });
      });
      document.getElementById('notes-textarea').value=globalNotes;
      document.querySelectorAll('.tb-view-opt').forEach(el => el.classList.remove('active'));
      const avb = document.getElementById('view-' + viewMode);
      if (avb) avb.classList.add('active');
      save(); renderAll(); fitView(); toast('Imported!');
    } catch(err) { toast('Could not load file'); }
  };
  reader.readAsText(file); event.target.value='';
}

function handleFileDrop(event) {
  const file = event.dataTransfer.files[0];
  if (!file) return;
  if (!file.name.endsWith('.json')) { toast('Please drop a .json file'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      world.querySelectorAll('.doctor-node').forEach(el => el.remove());
      doctors = data.doctors || []; edges = data.edges || []; nextId = data.nextId || 1;
      customTags = data.customTags || []; tagOverrides = data.tagOverrides || {};
      customActionTypes = data.customActionTypes || []; actionTypeOverrides = data.actionTypeOverrides || {};
      globalNotes = data.globalNotes || '';
      viewMode = data.viewMode || 'nucleus';
      doctors.forEach(d => {
        if (d.addedAt === undefined) d.addedAt = new Date().toISOString();
        if (d.isNode === undefined) d.isNode = false;
        if (d.isPatient === undefined) d.isPatient = false;
        if (d.isDeactivated === undefined) d.isDeactivated = false;
        if (d.documents === undefined) d.documents = [];
        (d.actions || []).forEach(a => { if (!a.links) a.links = []; });
      });
      document.getElementById('notes-textarea').value = globalNotes;
      document.querySelectorAll('.tb-view-opt').forEach(el => el.classList.remove('active'));
      const avb2 = document.getElementById('view-' + viewMode);
      if (avb2) avb2.classList.add('active');
      save(); renderAll(); fitView(); toast('Loaded!');
    } catch (err) { toast('Could not load file'); }
  };
  reader.readAsText(file);
}

// ===== DATA VIEW PANEL =====
let dvExpandedRows = new Set();

window.toggleDataView = function() {
  const panel = document.getElementById('data-view-panel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) renderDataView();
};

window.renderDataView = function() {
  const tbody = document.getElementById('dv-tbody');
  const emptyEl = document.getElementById('dv-empty');
  const searchVal = (document.getElementById('dv-search')?.value || '').toLowerCase().trim();

  if (doctors.length === 0) {
    tbody.innerHTML = '';
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  // Build tree structure
  const targeted = new Set(edges.map(e => e.to));
  const roots = doctors.filter(d => !targeted.has(d.id));
  const childrenOf = {};
  edges.forEach(e => { if (!childrenOf[e.from]) childrenOf[e.from] = []; childrenOf[e.from].push(e.to); });

  const rows = [];
  const visited = new Set();

  function walk(id, depth) {
    if (visited.has(id)) return;
    visited.add(id);
    const doc = doctors.find(d => d.id === id);
    if (!doc) return;
    const kids = (childrenOf[id] || []).filter(cid => !visited.has(cid) && doctors.find(d => d.id === cid));
    // Search filter
    if (searchVal) {
      const tagLabels = (doc.tags||[]).map(tid => { const t = getTagById(tid); return t ? t.label : ''; }).join(' ');
      const haystack = `${doc.name} ${doc.specialty||''} ${doc.notes||''} ${tagLabels}`.toLowerCase();
      if (!haystack.includes(searchVal) && kids.length === 0) return;
    }
    rows.push({ doc, depth, kids });
    if (dvExpandedRows.has(id)) {
      kids.forEach(cid => walk(cid, depth + 1));
    }
  }
  roots.forEach(r => walk(r.id, 0));
  // Orphans
  doctors.forEach(d => { if (!visited.has(d.id)) { rows.push({ doc: d, depth: 0, kids: [] }); } });

  tbody.innerHTML = rows.map(({ doc: d, depth, kids }) => {
    const indent = depth * 20;
    const hasKids = kids.length > 0;
    const isExp = dvExpandedRows.has(d.id);

    // Row class
    let rc = '';
    if (d.closedOut) rc = 'dv-closed';
    else if (d.isDeactivated) rc = 'dv-deactivated';
    else if (d.isPatient) rc = 'dv-patient';
    else if (d.isNode) rc = 'dv-node';

    // Type badge
    let typeBadge, typeClass;
    if (d.isPatient) { typeBadge = 'Patient'; typeClass = 'dv-type-patient'; }
    else if (d.isNode) { typeBadge = 'Node'; typeClass = 'dv-type-node'; }
    else { typeBadge = 'Doctor'; typeClass = 'dv-type-doctor'; }

    // Status
    let statusBadge, statusClass;
    if (d.closedOut) { statusBadge = 'Closed'; statusClass = 'dv-status-closed'; }
    else if (d.isDeactivated) { statusBadge = 'Inactive'; statusClass = 'dv-status-deactivated'; }
    else if (d.isPatient) { statusBadge = 'Patient'; statusClass = 'dv-status-patient'; }
    else { statusBadge = 'Active'; statusClass = 'dv-status-active'; }

    // Tags
    const tagsHtml = (d.tags||[]).map(tid => {
      const tag = getTagById(tid);
      return tag ? `<span class="n-tag ${tag.color}" style="font-size:9px;padding:1px 5px">${tag.label}</span>` : '';
    }).join('');

    // Actions
    const actionCount = (d.actions||[]).length;
    let actionsCell = actionCount > 0 ? `<button class="dv-expand-btn" data-dv-actions="${d.id}">${actionCount}</button>` : '0';

    // Links
    const linkCount = (d.links||[]).length;

    // Docs
    const docCount = (d.documents||[]).length;

    return `<tr class="${rc}" data-dv-id="${d.id}">
      <td><div style="display:flex;align-items:center">
        <span class="dv-indent" style="width:${indent}px"></span>
        ${hasKids ? `<span class="dv-chevron ${isExp?'expanded':''}" data-dv-toggle="${d.id}">▶</span>` : '<span style="width:16px;display:inline-block"></span>'}
        <span class="dv-name-editable" contenteditable="true" data-dv-field="name" data-dv-id="${d.id}">${d.name||''}</span>
      </div></td>
      <td><span class="dv-type-badge ${typeClass}">${typeBadge}</span></td>
      <td><span class="dv-spec-editable" contenteditable="true" data-dv-field="specialty" data-dv-id="${d.id}">${d.specialty||''}</span></td>
      <td><span class="dv-status-badge ${statusClass}">${statusBadge}</span></td>
      <td><div style="display:flex;flex-wrap:wrap;gap:2px">${tagsHtml}</div></td>
      <td>${actionsCell}</td>
      <td>${linkCount}</td>
      <td>${docCount}</td>
    </tr>`;
  }).join('');

  // Wire chevron toggles
  tbody.querySelectorAll('[data-dv-toggle]').forEach(chev => {
    chev.addEventListener('click', () => {
      const id = parseInt(chev.dataset.dvToggle);
      if (dvExpandedRows.has(id)) dvExpandedRows.delete(id); else dvExpandedRows.add(id);
      renderDataView();
    });
  });

  // Wire inline editing
  tbody.querySelectorAll('[data-dv-field]').forEach(el => {
    el.addEventListener('blur', () => {
      const id = parseInt(el.dataset.dvId);
      const field = el.dataset.dvField;
      const doc = doctors.find(d => d.id === id);
      if (doc && doc[field] !== el.textContent.trim()) {
        doc[field] = el.textContent.trim();
        save(); renderNode(doc); renderEdges();
      }
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
  });

  // Wire action expand buttons
  tbody.querySelectorAll('[data-dv-actions]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.dvActions);
      const doc = doctors.find(d => d.id === id);
      if (!doc) return;
      const row = btn.closest('tr');
      const existing = row.nextElementSibling?.classList.contains('dv-action-row');
      if (existing) { row.nextElementSibling.remove(); return; }
      const actionsHtml = (doc.actions||[]).map(a => {
        const dc = a.dotColor || 'blue';
        return `<div class="dv-action-item"><span class="dv-action-dot" style="background:${TAG_COLOR_HEX[dc]||'#3b82f6'}"></span><span>${a.date ? a.date + ' — ' : ''}${a.text}</span></div>`;
      }).join('');
      const newRow = document.createElement('tr');
      newRow.className = 'dv-action-row';
      newRow.innerHTML = `<td colspan="8" style="padding:4px 10px 8px ${parseInt(row.querySelector('.dv-indent')?.style.width||0)+32}px"><div class="dv-action-list">${actionsHtml}</div></td>`;
      row.after(newRow);
    });
  });

  // Expand roots by default on first render
  if (dvExpandedRows.size === 0) {
    roots.forEach(r => dvExpandedRows.add(r.id));
    renderDataView();
  }
};

// ===== CROSS-TAB SYNC =====
window.addEventListener('storage', e => {
  if (e.key === 'doctor-network') {
    load();
    toast('Data updated from another tab');
  }
});

// ===== INIT =====
load(); updateTransform(); updateEmpty();
// Set default view mode radio button
if (!document.querySelector('.tb-view-opt.active')) {
  const defBtn = document.getElementById('view-' + viewMode);
  if (defBtn) defBtn.classList.add('active');
}
