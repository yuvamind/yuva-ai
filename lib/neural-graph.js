const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Neural Graph — a knowledge graph that maps code relationships like
 * neurons map in a brain. Each node is an entity (file, function,
 * concept, decision), each edge is a relationship (imports, calls,
 * depends-on, implements). The graph is traversed to produce
 * token-efficient context for AI prompts.
 *
 * Instead of dumping the entire codebase into every prompt, we:
 * 1. Find the nodes relevant to the current task
 * 2. Traverse the graph N hops from those nodes
 * 3. Inject only that subgraph as context
 *
 * This reduces tokens by 60-80% compared to full codebase dumps.
 */

// Node types
const NODE_TYPES = {
  FILE: 'file',
  FUNCTION: 'function',
  CLASS: 'class',
  MODULE: 'module',
  CONCEPT: 'concept',
  DECISION: 'decision',
  PATTERN: 'pattern',
  SESSION: 'session',
  ERROR: 'error',
  TEST: 'test',
  CONFIG: 'config',
  API_ROUTE: 'api_route',
  DB_MODEL: 'db_model',
  COMPONENT: 'component',
};

// Edge types
const EDGE_TYPES = {
  IMPORTS: 'imports',
  EXPORTS: 'exports',
  CALLS: 'calls',
  CONTAINS: 'contains',
  DEPENDS_ON: 'depends_on',
  TESTS: 'tests',
  TESTED_BY: 'tested_by',
  IMPLEMENTS: 'implements',
  DECIDED_IN: 'decided_in',
  SIMILAR_TO: 'similar_to',
  DEPENDS_ON_CONCEPT: 'depends_on_concept',
  HANDLES: 'handles',
  USES: 'uses',
  CREATES: 'creates',
  MODIFIES: 'modifies',
  CONNECTS_TO: 'connects_to',
};

class NeuralGraph {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.graphDir = path.join(projectDir, '.yuva', 'graph');
    this.graphFile = path.join(this.graphDir, 'graph.json');
    this.indexFile = path.join(this.graphDir, 'index.json');

    // Core data structures
    this.nodes = new Map();        // id -> { type, name, file, summary, metadata, updatedAt }
    this.edges = new Map();        // fromId -> Map<toId, { type, weight, metadata }>
    this.reverseEdges = new Map(); // toId -> Set<fromId> (for reverse lookups)
    this.index = new Map();        // token -> Set<nodeId> (inverted index for search)
    this.adjacency = new Map();    // nodeId -> Set<neighborId> (undirected for traversal)
  }

  // ── Persistence ────────────────────────────────────────────────

  _ensureDir() {
    fs.mkdirSync(this.graphDir, { recursive: true });
  }

  save() {
    this._ensureDir();
    const data = {
      version: 1,
      savedAt: new Date().toISOString(),
      projectDir: this.projectDir,
      nodes: Object.fromEntries(
        [...this.nodes.entries()].map(([id, node]) => [id, { ...node }])
      ),
      edges: this._serializeEdges(),
    };
    fs.writeFileSync(this.graphFile, JSON.stringify(data, null, 2));

    // Save inverted index separately (rebuilt on load if missing)
    const indexData = {};
    for (const [token, ids] of this.index.entries()) {
      indexData[token] = [...ids];
    }
    fs.writeFileSync(this.indexFile, JSON.stringify(indexData));
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.graphFile, 'utf8'));
      if (data.version !== 1) return false;

      this.nodes = new Map();
      for (const [id, node] of Object.entries(data.nodes || {})) {
        this.nodes.set(id, node);
      }

      this.edges = new Map();
      this.reverseEdges = new Map();
      this.adjacency = new Map();
      for (const edge of (data.edges || [])) {
        this._addEdgeInternal(edge.from, edge.to, edge);
      }

      // Load or rebuild index
      this._rebuildIndex();
      return true;
    } catch {
      return false;
    }
  }

  _serializeEdges() {
    const edges = [];
    for (const [fromId, toMap] of this.edges.entries()) {
      for (const [toId, edge] of toMap.entries()) {
        edges.push({ from: fromId, to: toId, ...edge });
      }
    }
    return edges;
  }

  // ── Node Operations ────────────────────────────────────────────

  addNode(type, name, { file = null, summary = '', metadata = {} } = {}) {
    const id = this._makeId(type, name, file);
    if (this.nodes.has(id)) {
      // Update existing node
      const existing = this.nodes.get(id);
      if (summary) existing.summary = summary;
      existing.updatedAt = new Date().toISOString();
      Object.assign(existing.metadata, metadata);
      this._indexNode(id, existing);
      return id;
    }

    const node = {
      id,
      type,
      name,
      file: file ? file.replace(/\\/g, '/') : null,
      summary: summary || '',
      metadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accessCount: 0,
      lastAccessedAt: null,
    };

    this.nodes.set(id, node);
    this._indexNode(id, node);
    return id;
  }

  getNode(id) {
    const node = this.nodes.get(id);
    if (node) {
      node.accessCount = (node.accessCount || 0) + 1;
      node.lastAccessedAt = new Date().toISOString();
    }
    return node;
  }

  getNodesByType(type) {
    return [...this.nodes.values()].filter(n => n.type === type);
  }

  getNodesByFile(file) {
    const normalized = file.replace(/\\/g, '/');
    return [...this.nodes.values()].filter(n => n.file === normalized);
  }

  // ── Edge Operations ────────────────────────────────────────────

  addEdge(fromId, toId, type, { weight = 1, metadata = {} } = {}) {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) return false;
    this._addEdgeInternal(fromId, toId, { type, weight, metadata });
    return true;
  }

  _addEdgeInternal(fromId, toId, edgeData) {
    if (!this.edges.has(fromId)) this.edges.set(fromId, new Map());
    this.edges.get(fromId).set(toId, edgeData);

    if (!this.reverseEdges.has(toId)) this.reverseEdges.set(toId, new Set());
    this.reverseEdges.get(toId).add(fromId);

    // Undirected adjacency for traversal
    if (!this.adjacency.has(fromId)) this.adjacency.set(fromId, new Set());
    if (!this.adjacency.has(toId)) this.adjacency.set(toId, new Set());
    this.adjacency.get(fromId).add(toId);
    this.adjacency.get(toId).add(fromId);
  }

  getEdgesFrom(nodeId) {
    const edges = this.edges.get(nodeId);
    if (!edges) return [];
    return [...edges.entries()].map(([toId, data]) => ({ from: nodeId, to: toId, ...data }));
  }

  getEdgesTo(nodeId) {
    const sources = this.reverseEdges.get(nodeId);
    if (!sources) return [];
    return [...sources].map(fromId => {
      const data = this.edges.get(fromId)?.get(nodeId);
      return { from: fromId, to: nodeId, ...(data || {}) };
    });
  }

  getNeighbors(nodeId) {
    return [...(this.adjacency.get(nodeId) || [])];
  }

  // ── Traversal (the brain's neural pathway activation) ──────────

  /**
   * BFS traversal from a set of start nodes. Returns all nodes
   * within `depth` hops, with their connecting edges.
   * This is the core "thinking" operation — like activating a
   * region of the brain by stimulating specific neurons.
   *
   * Returns: { nodes: Map<id, node>, edges: Array, depth: Map<id, hopDistance> }
   */
  traverse(startIds, { maxDepth = 2, maxNodes = 50, edgeFilter = null } = {}) {
    const visited = new Map(); // nodeId -> depth
    const resultEdges = [];
    const queue = [];

    for (const id of startIds) {
      if (this.nodes.has(id)) {
        queue.push({ id, depth: 0 });
        visited.set(id, 0);
      }
    }

    while (queue.length > 0 && visited.size < maxNodes) {
      const { id, depth } = queue.shift();
      if (depth >= maxDepth) continue;

      const neighbors = this.adjacency.get(id) || new Set();
      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;
        if (visited.size >= maxNodes) break;

        // Get edge data
        const edgeData = this.edges.get(id)?.get(neighborId) ||
                         this.edges.get(neighborId)?.get(id);

        // Apply edge filter
        if (edgeFilter && edgeData && !edgeFilter(edgeData.type)) continue;

        visited.set(neighborId, depth + 1);
        queue.push({ id: neighborId, depth: depth + 1 });

        if (edgeData) {
          resultEdges.push({ from: id, to: neighborId, ...edgeData });
        }
      }
    }

    const resultNodes = new Map();
    for (const [id, depth] of visited.entries()) {
      const node = this.nodes.get(id);
      if (node) resultNodes.set(id, { ...node, _depth: depth });
    }

    return { nodes: resultNodes, edges: resultEdges, depth: visited };
  }

  /**
   * Find the shortest path between two nodes.
   * Like finding the neural pathway between two concepts.
   */
  findPath(fromId, toId, maxDepth = 5) {
    if (fromId === toId) return [fromId];

    const visited = new Set([fromId]);
    const queue = [[fromId]];

    while (queue.length > 0) {
      const path = queue.shift();
      if (path.length > maxDepth) return null;

      const current = path[path.length - 1];
      const neighbors = this.adjacency.get(current) || new Set();

      for (const neighbor of neighbors) {
        if (neighbor === toId) return [...path, neighbor];
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([...path, neighbor]);
        }
      }
    }
    return null;
  }

  // ── Search (the brain's associative recall) ────────────────────

  /**
   * Search for nodes matching a text query. Uses the inverted index
   * for fast lookup, then ranks by relevance.
   */
  query(text, { limit = 20, types = null } = {}) {
    const tokens = this._tokenize(text);
    const scores = new Map(); // nodeId -> score

    for (const token of tokens) {
      // Exact match
      const exact = this.index.get(token);
      if (exact) {
        for (const id of exact) {
          scores.set(id, (scores.get(id) || 0) + 2);
        }
      }
      // Prefix match
      for (const [indexToken, ids] of this.index.entries()) {
        if (indexToken.startsWith(token) && indexToken !== token) {
          for (const id of ids) {
            scores.set(id, (scores.get(id) || 0) + 1);
          }
        }
      }
    }

    // Filter by type
    let results = [...scores.entries()]
      .map(([id, score]) => ({ node: this.nodes.get(id), score }))
      .filter(r => r.node);

    if (types) {
      const typeSet = new Set(Array.isArray(types) ? types : [types]);
      results = results.filter(r => typeSet.has(r.node.type));
    }

    // Sort by score (desc), then access count (desc)
    results.sort((a, b) => (b.score - a.score) || ((b.node.accessCount || 0) - (a.node.accessCount || 0)));

    return results.slice(0, limit).map(r => ({
      ...r.node,
      relevanceScore: r.score,
    }));
  }

  /**
   * Get the "relevance neighborhood" for a task — find the most
   * relevant nodes, then traverse their connections.
   * This is how the brain focuses: activate the relevant neurons,
   * then let the connections spread.
   */
  getContextForTask(taskTitle, taskDescription = '', { maxDepth = 2, maxNodes = 30 } = {}) {
    const queryText = `${taskTitle} ${taskDescription}`;

    // 1. Find directly relevant nodes
    const directMatches = this.query(queryText, { limit: 10 });

    // 2. Traverse from those nodes to find related context
    const startIds = directMatches.map(n => n.id);
    if (startIds.length === 0) {
      return { nodes: new Map(), edges: [], tokens: 0, summary: 'No relevant context found in graph.' };
    }

    const subgraph = this.traverse(startIds, { maxDepth, maxNodes });

    // 3. Format as compact context
    const summary = this._formatSubgraph(subgraph, taskTitle);

    // 4. Estimate token count (rough: 1 token per 4 chars)
    const tokens = Math.ceil(summary.length / 4);

    return {
      nodes: subgraph.nodes,
      edges: subgraph.edges,
      tokens,
      summary,
      directMatches: directMatches.map(n => n.id),
    };
  }

  // ── Learning (the brain's plasticity) ──────────────────────────

  /**
   * Learn from a completed task — update the graph based on what
   * files were changed, what functions were affected, what concepts
   * were involved. This is like the brain strengthening connections
   * that were recently used.
   */
  learnFromTask(task, changedFiles = []) {
    // Create a session node for this task
    const sessionNodeId = this.addNode(NODE_TYPES.SESSION, task.title, {
      summary: task.summary || task.description || '',
      metadata: {
        taskId: task.id,
        role: task.role,
        status: task.status,
        attempts: task.attempts,
      },
    });

    // Connect changed files to the session
    for (const file of changedFiles) {
      const fileNodeId = this.addNode(NODE_TYPES.FILE, path.basename(file), {
        file,
        summary: '',
      });
      this.addEdge(sessionNodeId, fileNodeId, EDGE_TYPES.MODIFIES, { weight: 2 });

      // Connect file to its containing module/directory
      const dir = path.dirname(file);
      if (dir && dir !== '.') {
        const moduleNodeId = this.addNode(NODE_TYPES.MODULE, dir, {
          summary: `Module: ${dir}`,
        });
        this.addEdge(moduleNodeId, fileNodeId, EDGE_TYPES.CONTAINS);
      }
    }

    // Extract concepts from the task title and description
    const concepts = this._extractConcepts(`${task.title} ${task.description || ''}`);
    for (const concept of concepts) {
      const conceptNodeId = this.addNode(NODE_TYPES.CONCEPT, concept, {
        summary: `Concept: ${concept}`,
      });
      this.addEdge(sessionNodeId, conceptNodeId, EDGE_TYPES.IMPLEMENTS);
    }

    // Strengthen edges between files that were changed together
    for (let i = 0; i < changedFiles.length; i++) {
      for (let j = i + 1; j < changedFiles.length; j++) {
        const idA = this._makeId(NODE_TYPES.FILE, path.basename(changedFiles[i]), changedFiles[i]);
        const idB = this._makeId(NODE_TYPES.FILE, path.basename(changedFiles[j]), changedFiles[j]);
        if (this.nodes.has(idA) && this.nodes.has(idB)) {
          // Increase weight of existing edge or create new one
          const existing = this.edges.get(idA)?.get(idB);
          const newWeight = (existing?.weight || 0) + 1;
          this.addEdge(idA, idB, EDGE_TYPES.CONNECTS_TO, { weight: newWeight });
        }
      }
    }

    // Record decisions
    if (task.decisions) {
      for (const decision of task.decisions) {
        const decisionNodeId = this.addNode(NODE_TYPES.DECISION, decision.what, {
          summary: decision.why,
        });
        this.addEdge(sessionNodeId, decisionNodeId, EDGE_TYPES.DECIDED_IN);
      }
    }

    return sessionNodeId;
  }

  /**
   * Learn from code analysis results — populate the graph with
   * structural information about the codebase.
   */
  learnFromAnalysis(analysis) {
    // Files and modules
    for (const file of (analysis.modules || [])) {
      this.addNode(NODE_TYPES.FILE, path.basename(file), {
        file,
        summary: '',
      });
    }

    // Exports (functions and classes)
    for (const [file, exports] of Object.entries(analysis.exports || {})) {
      const fileNodeId = this._makeId(NODE_TYPES.FILE, path.basename(file), file);
      for (const exportName of exports) {
        const funcNodeId = this.addNode(NODE_TYPES.FUNCTION, exportName, {
          file,
          summary: `Exported from ${file}`,
        });
        this.addEdge(fileNodeId, funcNodeId, EDGE_TYPES.CONTAINS);
      }
    }

    // Imports (dependencies between files)
    for (const [file, imports] of Object.entries(analysis.imports || {})) {
      const fileNodeId = this._makeId(NODE_TYPES.FILE, path.basename(file), file);
      for (const imp of imports) {
        // Try to find the imported module in our graph
        const candidates = this.query(imp, { types: [NODE_TYPES.FILE, NODE_TYPES.MODULE] });
        if (candidates.length > 0) {
          this.addEdge(fileNodeId, candidates[0].id, EDGE_TYPES.IMPORTS);
        }
      }
    }

    // API routes
    for (const route of (analysis.apiRoutes || [])) {
      const routeNodeId = this.addNode(NODE_TYPES.API_ROUTE, `${route.method} ${route.path}`, {
        file: route.file,
        summary: `${route.method} ${route.path}`,
      });
      if (route.file) {
        const fileNodeId = this._makeId(NODE_TYPES.FILE, path.basename(route.file), route.file);
        this.addEdge(fileNodeId, routeNodeId, EDGE_TYPES.HANDLES);
      }
    }

    // Components
    for (const comp of (analysis.components || [])) {
      this.addNode(NODE_TYPES.COMPONENT, comp.name, {
        file: comp.file,
        summary: `React component: ${comp.name}`,
      });
    }

    // DB models
    for (const model of (analysis.databaseModels || [])) {
      this.addNode(NODE_TYPES.DB_MODEL, model.name, {
        file: model.file,
        summary: `Database model: ${model.name}`,
      });
    }

    // Env vars → connect to files that use them
    for (const envVar of (analysis.envVars || [])) {
      const envNodeId = this.addNode(NODE_TYPES.CONFIG, `ENV:${envVar}`, {
        summary: `Environment variable: ${envVar}`,
      });
    }
  }

  // ── Stats ──────────────────────────────────────────────────────

  getStats() {
    const nodesByType = {};
    for (const node of this.nodes.values()) {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
    }

    let totalEdges = 0;
    for (const edges of this.edges.values()) {
      totalEdges += edges.size;
    }

    const mostConnected = [...this.nodes.values()]
      .map(n => ({ ...n, connections: (this.adjacency.get(n.id) || new Set()).size }))
      .sort((a, b) => b.connections - a.connections)
      .slice(0, 10);

    const mostAccessed = [...this.nodes.values()]
      .sort((a, b) => (b.accessCount || 0) - (a.accessCount || 0))
      .slice(0, 10);

    return {
      totalNodes: this.nodes.size,
      totalEdges,
      nodesByType,
      indexTokens: this.index.size,
      mostConnected: mostConnected.map(n => ({
        name: n.name, type: n.type, connections: n.connections,
      })),
      mostAccessed: mostAccessed.map(n => ({
        name: n.name, type: n.type, accesses: n.accessCount || 0,
      })),
    };
  }

  // ── Formatting ─────────────────────────────────────────────────

  _formatSubgraph(subgraph, taskTitle) {
    const lines = [];
    lines.push(`### Neural Graph Context for: ${taskTitle}`);
    lines.push(`(traversed ${subgraph.nodes.size} nodes, ${subgraph.edges.length} edges)`);
    lines.push('');

    // Group nodes by type
    const byType = {};
    for (const [id, node] of subgraph.nodes.entries()) {
      if (!byType[node.type]) byType[node.type] = [];
      byType[node.type].push(node);
    }

    // Files
    if (byType[NODE_TYPES.FILE]) {
      lines.push('**Relevant Files:**');
      for (const node of byType[NODE_TYPES.FILE]) {
        const depth = node._depth || 0;
        const indent = '  '.repeat(depth);
        const summary = node.summary ? ` — ${node.summary}` : '';
        lines.push(`${indent}- \`${node.file || node.name}\`${summary}`);
      }
      lines.push('');
    }

    // Functions
    if (byType[NODE_TYPES.FUNCTION]) {
      lines.push('**Relevant Functions:**');
      for (const node of byType[NODE_TYPES.FUNCTION]) {
        const summary = node.summary ? ` — ${node.summary}` : '';
        lines.push(`- \`${node.name}\`${summary}`);
      }
      lines.push('');
    }

    // API Routes
    if (byType[NODE_TYPES.API_ROUTE]) {
      lines.push('**Relevant API Routes:**');
      for (const node of byType[NODE_TYPES.API_ROUTE]) {
        lines.push(`- ${node.name}`);
      }
      lines.push('');
    }

    // Concepts
    if (byType[NODE_TYPES.CONCEPT]) {
      lines.push('**Related Concepts:**');
      for (const node of byType[NODE_TYPES.CONCEPT]) {
        lines.push(`- ${node.name}`);
      }
      lines.push('');
    }

    // Decisions
    if (byType[NODE_TYPES.DECISION]) {
      lines.push('**Past Decisions:**');
      for (const node of byType[NODE_TYPES.DECISION]) {
        lines.push(`- ${node.name}${node.summary ? ` — ${node.summary}` : ''}`);
      }
      lines.push('');
    }

    // Past sessions
    if (byType[NODE_TYPES.SESSION]) {
      lines.push('**Related Past Work:**');
      for (const node of byType[NODE_TYPES.SESSION]) {
        const meta = node.metadata || {};
        const role = meta.role ? ` (${meta.role})` : '';
        lines.push(`- ${node.name}${role}${node.summary ? ` — ${node.summary}` : ''}`);
      }
      lines.push('');
    }

    // Connections (edges)
    if (subgraph.edges.length > 0) {
      lines.push('**Key Connections:**');
      const edgeSummary = subgraph.edges.slice(0, 15).map(e => {
        const from = this.nodes.get(e.from);
        const to = this.nodes.get(e.to);
        if (!from || !to) return null;
        return `- ${from.name} →[${e.type}]→ ${to.name}`;
      }).filter(Boolean);
      lines.push(...edgeSummary);
      if (subgraph.edges.length > 15) {
        lines.push(`- ... and ${subgraph.edges.length - 15} more connections`);
      }
    }

    return lines.join('\n');
  }

  // ── Internal helpers ───────────────────────────────────────────

  _makeId(type, name, file = null) {
    const key = file ? `${type}:${file}:${name}` : `${type}:${name}`;
    // Short hash to keep IDs compact
    return crypto.createHash('md5').update(key).digest('hex').slice(0, 12);
  }

  _tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9/._-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2)
      .slice(0, 50);
  }

  _indexNode(id, node) {
    const tokens = this._tokenize(`${node.name} ${node.file || ''} ${node.summary || ''} ${node.type}`);
    for (const token of tokens) {
      if (!this.index.has(token)) this.index.set(token, new Set());
      this.index.get(token).add(id);
    }
  }

  _rebuildIndex() {
    this.index = new Map();
    for (const [id, node] of this.nodes.entries()) {
      this._indexNode(id, node);
    }
  }

  _extractConcepts(text) {
    const conceptPatterns = [
      /auth(?:entication|orization)?/i,
      /validat(?:ion|e|ing)/i,
      /error.handling/i,
      /database|db|sql|mongo/i,
      /api|rest|graphql/i,
      /test(?:ing|s)?/i,
      /security/i,
      /deploy(?:ment)?/i,
      /config(?:uration)?/i,
      /middleware/i,
      /routing/i,
      /state.management/i,
      /caching/i,
      /logging/i,
      /pagination/i,
      /file.upload/i,
      /email|notification/i,
      /payment|billing/i,
      /search/i,
      /i18n|localization/i,
    ];

    const concepts = [];
    const lower = text.toLowerCase();
    for (const pattern of conceptPatterns) {
      if (pattern.test(lower)) {
        concepts.push(pattern.source.replace(/[\\/?^$|()[\]]/g, '').split('|')[0]);
      }
    }
    return [...new Set(concepts)];
  }

  /**
   * Clear the graph completely.
   */
  clear() {
    this.nodes = new Map();
    this.edges = new Map();
    this.reverseEdges = new Map();
    this.adjacency = new Map();
    this.index = new Map();
    if (fs.existsSync(this.graphDir)) {
      fs.rmSync(this.graphDir, { recursive: true, force: true });
    }
  }
}

module.exports = { NeuralGraph, NODE_TYPES, EDGE_TYPES };
