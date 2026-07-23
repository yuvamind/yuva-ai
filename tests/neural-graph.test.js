const fs = require('fs');
const path = require('path');
const os = require('os');
const { NeuralGraph, NODE_TYPES, EDGE_TYPES } = require('../lib/neural-graph');

describe('NeuralGraph', () => {
  let tmpDir;
  let graph;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-test-'));
    graph = new NeuralGraph(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('nodes', () => {
    it('should add and retrieve nodes', () => {
      const id = graph.addNode(NODE_TYPES.FILE, 'auth.js', { file: 'src/auth.js', summary: 'Auth module' });
      const node = graph.getNode(id);
      expect(node.name).toBe('auth.js');
      expect(node.type).toBe(NODE_TYPES.FILE);
      expect(node.file).toBe('src/auth.js');
      expect(node.summary).toBe('Auth module');
    });

    it('should update existing nodes', () => {
      const id1 = graph.addNode(NODE_TYPES.FILE, 'auth.js', { file: 'src/auth.js' });
      const id2 = graph.addNode(NODE_TYPES.FILE, 'auth.js', { file: 'src/auth.js', summary: 'updated' });
      expect(id1).toBe(id2);
      expect(graph.getNode(id2).summary).toBe('updated');
    });

    it('should find nodes by type', () => {
      graph.addNode(NODE_TYPES.FILE, 'a.js');
      graph.addNode(NODE_TYPES.FILE, 'b.js');
      graph.addNode(NODE_TYPES.FUNCTION, 'login');

      expect(graph.getNodesByType(NODE_TYPES.FILE).length).toBe(2);
      expect(graph.getNodesByType(NODE_TYPES.FUNCTION).length).toBe(1);
    });

    it('should find nodes by file', () => {
      graph.addNode(NODE_TYPES.FILE, 'auth.js', { file: 'src/auth.js' });
      graph.addNode(NODE_TYPES.FUNCTION, 'login', { file: 'src/auth.js' });
      graph.addNode(NODE_TYPES.FILE, 'db.js', { file: 'src/db.js' });

      const authNodes = graph.getNodesByFile('src/auth.js');
      expect(authNodes.length).toBe(2);
    });
  });

  describe('edges', () => {
    it('should add and traverse edges', () => {
      const a = graph.addNode(NODE_TYPES.FILE, 'auth.js', { file: 'src/auth.js' });
      const b = graph.addNode(NODE_TYPES.FILE, 'db.js', { file: 'src/db.js' });
      graph.addEdge(a, b, EDGE_TYPES.IMPORTS);

      const edgesFrom = graph.getEdgesFrom(a);
      expect(edgesFrom.length).toBe(1);
      expect(edgesFrom[0].to).toBe(b);
      expect(edgesFrom[0].type).toBe(EDGE_TYPES.IMPORTS);

      const edgesTo = graph.getEdgesTo(b);
      expect(edgesTo.length).toBe(1);
      expect(edgesTo[0].from).toBe(a);
    });

    it('should list neighbors', () => {
      const a = graph.addNode(NODE_TYPES.FILE, 'a.js');
      const b = graph.addNode(NODE_TYPES.FILE, 'b.js');
      const c = graph.addNode(NODE_TYPES.FILE, 'c.js');
      graph.addEdge(a, b, EDGE_TYPES.IMPORTS);
      graph.addEdge(a, c, EDGE_TYPES.DEPENDS_ON);

      const neighbors = graph.getNeighbors(a);
      expect(neighbors.length).toBe(2);
      expect(neighbors).toContain(b);
      expect(neighbors).toContain(c);
    });
  });

  describe('traverse()', () => {
    it('should traverse connected nodes', () => {
      const a = graph.addNode(NODE_TYPES.FILE, 'auth.js');
      const b = graph.addNode(NODE_TYPES.FILE, 'db.js');
      const c = graph.addNode(NODE_TYPES.FILE, 'api.js');
      const d = graph.addNode(NODE_TYPES.FILE, 'utils.js');

      graph.addEdge(a, b, EDGE_TYPES.IMPORTS);
      graph.addEdge(b, c, EDGE_TYPES.IMPORTS);
      graph.addEdge(a, d, EDGE_TYPES.DEPENDS_ON);

      const result = graph.traverse([a], { maxDepth: 2 });
      expect(result.nodes.size).toBe(4); // a, b, c, d
      expect(result.edges.length).toBeGreaterThan(0);
    });

    it('should respect maxDepth', () => {
      const a = graph.addNode(NODE_TYPES.FILE, 'a.js');
      const b = graph.addNode(NODE_TYPES.FILE, 'b.js');
      const c = graph.addNode(NODE_TYPES.FILE, 'c.js');

      graph.addEdge(a, b, EDGE_TYPES.IMPORTS);
      graph.addEdge(b, c, EDGE_TYPES.IMPORTS);

      const result = graph.traverse([a], { maxDepth: 1 });
      expect(result.nodes.size).toBe(2); // a and b only (c is 2 hops away)
    });

    it('should respect maxNodes', () => {
      const nodes = [];
      for (let i = 0; i < 10; i++) {
        nodes.push(graph.addNode(NODE_TYPES.FILE, `f${i}.js`));
      }
      for (let i = 0; i < 9; i++) {
        graph.addEdge(nodes[i], nodes[i + 1], EDGE_TYPES.IMPORTS);
      }

      const result = graph.traverse([nodes[0]], { maxNodes: 3 });
      expect(result.nodes.size).toBeLessThanOrEqual(3);
    });
  });

  describe('findPath()', () => {
    it('should find shortest path', () => {
      const a = graph.addNode(NODE_TYPES.FILE, 'a.js');
      const b = graph.addNode(NODE_TYPES.FILE, 'b.js');
      const c = graph.addNode(NODE_TYPES.FILE, 'c.js');

      graph.addEdge(a, b, EDGE_TYPES.IMPORTS);
      graph.addEdge(b, c, EDGE_TYPES.IMPORTS);

      const path = graph.findPath(a, c);
      expect(path).toEqual([a, b, c]);
    });

    it('should return null for disconnected nodes', () => {
      const a = graph.addNode(NODE_TYPES.FILE, 'a.js');
      const b = graph.addNode(NODE_TYPES.FILE, 'b.js');

      const path = graph.findPath(a, b);
      expect(path).toBeNull();
    });
  });

  describe('query()', () => {
    it('should find nodes by name', () => {
      graph.addNode(NODE_TYPES.FILE, 'auth.js', { file: 'src/auth.js' });
      graph.addNode(NODE_TYPES.FILE, 'db.js', { file: 'src/db.js' });
      graph.addNode(NODE_TYPES.FUNCTION, 'login', { file: 'src/auth.js' });

      const results = graph.query('auth');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.name === 'auth.js')).toBe(true);
    });

    it('should rank by relevance', () => {
      graph.addNode(NODE_TYPES.FILE, 'auth.js', { file: 'src/auth.js', summary: 'authentication module' });
      graph.addNode(NODE_TYPES.FILE, 'utils.js', { file: 'src/utils.js', summary: 'utility functions' });

      const results = graph.query('auth');
      expect(results[0].name).toBe('auth.js');
    });

    it('should filter by type', () => {
      graph.addNode(NODE_TYPES.FILE, 'auth.js');
      graph.addNode(NODE_TYPES.FUNCTION, 'authenticate');

      const files = graph.query('auth', { types: NODE_TYPES.FILE });
      expect(files.every(r => r.type === NODE_TYPES.FILE)).toBe(true);
    });
  });

  describe('getContextForTask()', () => {
    it('should return relevant subgraph', () => {
      graph.addNode(NODE_TYPES.FILE, 'auth.js', { file: 'src/auth.js', summary: 'authentication' });
      graph.addNode(NODE_TYPES.FILE, 'db.js', { file: 'src/db.js', summary: 'database' });
      graph.addNode(NODE_TYPES.FUNCTION, 'login', { file: 'src/auth.js' });

      const ctx = graph.getContextForTask('fix the login bug', 'authentication is broken');
      expect(ctx).toHaveProperty('nodes');
      expect(ctx).toHaveProperty('edges');
      expect(ctx).toHaveProperty('tokens');
      expect(ctx).toHaveProperty('summary');
    });
  });

  describe('persistence', () => {
    it('should save and load', () => {
      graph.addNode(NODE_TYPES.FILE, 'auth.js', { file: 'src/auth.js' });
      const b = graph.addNode(NODE_TYPES.FILE, 'db.js', { file: 'src/db.js' });
      graph.addEdge(graph.getNodesByType(NODE_TYPES.FILE)[0].id, b, EDGE_TYPES.IMPORTS);
      graph.save();

      const graph2 = new NeuralGraph(tmpDir);
      expect(graph2.load()).toBe(true);
      expect(graph2.nodes.size).toBe(2);
      expect(graph2.edges.size).toBe(1);
    });
  });

  describe('learnFromTask()', () => {
    it('should create session node and connect files', () => {
      const task = { id: 't1', title: 'Build auth', role: 'executor', description: 'authentication system' };
      graph.addNode(NODE_TYPES.FILE, 'auth.js', { file: 'src/auth.js' });

      graph.learnFromTask(task, ['src/auth.js', 'src/db.js']);

      expect(graph.getNodesByType(NODE_TYPES.SESSION).length).toBe(1);
      expect(graph.getNodesByType(NODE_TYPES.SESSION)[0].name).toBe('Build auth');
    });

    it('should connect files changed together', () => {
      graph.addNode(NODE_TYPES.FILE, 'a.js', { file: 'src/a.js' });
      graph.addNode(NODE_TYPES.FILE, 'b.js', { file: 'src/b.js' });

      const task = { id: 't1', title: 'Test', role: 'executor' };
      graph.learnFromTask(task, ['src/a.js', 'src/b.js']);

      // The files should be connected
      const aId = graph.getNodesByFile('src/a.js')[0]?.id;
      const bId = graph.getNodesByFile('src/b.js')[0]?.id;
      if (aId && bId) {
        const edges = graph.getEdgesFrom(aId);
        expect(edges.some(e => e.to === bId)).toBe(true);
      }
    });
  });

  describe('getStats()', () => {
    it('should return complete stats', () => {
      graph.addNode(NODE_TYPES.FILE, 'a.js');
      graph.addNode(NODE_TYPES.FUNCTION, 'login');

      const stats = graph.getStats();
      expect(stats.totalNodes).toBe(2);
      expect(stats.nodesByType[NODE_TYPES.FILE]).toBe(1);
      expect(stats.nodesByType[NODE_TYPES.FUNCTION]).toBe(1);
    });
  });
});
