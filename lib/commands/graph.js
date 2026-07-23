const { log, box, success, error, warn, info, table } = require('../colors');
const { NeuralGraph } = require('../neural-graph');
const { GraphBuilder } = require('../graph-builder');

function graphCommand(args = []) {
  const targetDir = process.cwd();
  const sub = args[0] || 'stats';

  switch (sub) {
    case 'build':
    case 'scan':
      return buildGraph(targetDir, args.slice(1));
    case 'query':
    case 'search':
      return queryGraph(targetDir, args.slice(1).join(' '));
    case 'stats':
    case 'status':
      return showStats(targetDir);
    case 'context':
      return showContext(targetDir, args.slice(1).join(' '));
    case 'clear':
      return clearGraph(targetDir);
    default:
      showGraphHelp();
  }
}

function showGraphHelp() {
  box('Yuva AI - Neural Graph');
  log('A knowledge graph that maps code relationships like a brain.', 'bright');
  log('Reduces token costs by injecting only relevant context.\n');
  log('Commands:', 'bright');
  log('  yuva graph build          Build/update the graph from codebase');
  log('  yuva graph build --force  Full rebuild (ignore cached graph)');
  log('  yuva graph stats          Show graph statistics');
  log('  yuva graph query <text>   Search for relevant nodes');
  log('  yuva graph context <task> Show what context a task would get');
  log('  yuva graph clear          Clear the graph\n');
  log('How it works:', 'bright');
  log('  1. yuva graph build scans your code and builds a knowledge graph');
  log('  2. When a worker claims a task, the graph is traversed to find');
  log('     only the relevant files, functions, and concepts');
  log('  3. Only that subgraph is injected as context (60-80% fewer tokens)');
  log('  4. After each task, the graph learns what files were changed together\n');
}

function buildGraph(targetDir, args) {
  box('Building Neural Graph');
  const force = args.includes('--force');
  if (force) info('Force rebuild — ignoring cached graph');

  const builder = new GraphBuilder(targetDir);
  const result = builder.build({ force });

  success(`Graph built in ${result.duration}ms`);
  log('');
  log(`  Nodes: ${result.stats.totalNodes}`);
  log(`  Edges: ${result.stats.totalEdges}`);
  log(`  Index tokens: ${result.stats.indexTokens}`);
  log('');

  if (Object.keys(result.stats.nodesByType).length > 0) {
    log('Node types:', 'bright');
    for (const [type, count] of Object.entries(result.stats.nodesByType)) {
      log(`  ${type.padEnd(15)} ${count}`);
    }
    log('');
  }

  if (result.stats.mostConnected.length > 0) {
    log('Most connected nodes (hub neurons):', 'bright');
    for (const node of result.stats.mostConnected.slice(0, 5)) {
      log(`  ${node.name.padEnd(25)} ${node.type.padEnd(10)} ${node.connections} connections`);
    }
    log('');
  }
}

function showStats(targetDir) {
  box('Neural Graph Stats');
  const graph = new NeuralGraph(targetDir);
  if (!graph.load()) {
    warn('No graph found. Run: yuva graph build');
    return;
  }

  const stats = graph.getStats();
  log(`  Total nodes: ${stats.totalNodes}`);
  log(`  Total edges: ${stats.totalEdges}`);
  log(`  Index tokens: ${stats.indexTokens}`);
  log('');

  if (Object.keys(stats.nodesByType).length > 0) {
    log('Node types:', 'bright');
    for (const [type, count] of Object.entries(stats.nodesByType)) {
      log(`  ${type.padEnd(15)} ${count}`);
    }
    log('');
  }

  if (stats.mostAccessed.length > 0 && stats.mostAccessed[0].accesses > 0) {
    log('Most accessed nodes (frequently recalled):', 'bright');
    for (const node of stats.mostAccessed.slice(0, 5)) {
      if (node.accesses > 0) log(`  ${node.name.padEnd(25)} ${node.accesses} accesses`);
    }
    log('');
  }
}

function queryGraph(targetDir, text) {
  if (!text) {
    error('Usage: yuva graph query <search text>');
    return;
  }

  const graph = new NeuralGraph(targetDir);
  if (!graph.load()) {
    warn('No graph found. Run: yuva graph build');
    return;
  }

  box(`Neural Graph Query: "${text}"`);
  const results = graph.query(text, { limit: 15 });

  if (results.length === 0) {
    info('No matching nodes found.');
    return;
  }

  for (const node of results) {
    const score = node.relevanceScore ? ` (score: ${node.relevanceScore})` : '';
    const file = node.file ? ` @ ${node.file}` : '';
    log(`  [${node.type}] ${node.name}${file}${score}`);
    if (node.summary) log(`    ${node.summary}`, 'dim');
  }
  log('');
}

function showContext(targetDir, text) {
  if (!text) {
    error('Usage: yuva graph context <task description>');
    return;
  }

  const graph = new NeuralGraph(targetDir);
  if (!graph.load()) {
    warn('No graph found. Run: yuva graph build');
    return;
  }

  box(`Context for: "${text}"`);
  const ctx = graph.getContextForTask(text);

  log(`  Nodes traversed: ${ctx.nodes.size}`);
  log(`  Edges found: ${ctx.edges.length}`);
  log(`  Estimated tokens: ~${ctx.tokens}`);
  log(`  (vs full codebase dump: ~${Math.ceil(ctx.tokens * 3.5)} tokens saved)`);
  log('');
  log(ctx.summary);
  log('');
}

function clearGraph(targetDir) {
  const graph = new NeuralGraph(targetDir);
  graph.clear();
  success('Graph cleared.\n');
}

module.exports = graphCommand;
