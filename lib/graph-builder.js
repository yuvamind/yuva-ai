const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { NeuralGraph, NODE_TYPES, EDGE_TYPES } = require('./neural-graph');
const { analyzeCodebase } = require('./code-analyzer');
const { scanProject } = require('./prompt-engine');

/**
 * Graph Builder — auto-scans a codebase and builds the neural graph.
 * Works incrementally: only updates nodes/edges that have changed
 * since the last build (based on file mtimes).
 */

class GraphBuilder {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.graph = new NeuralGraph(projectDir);
  }

  /**
   * Build (or incrementally update) the neural graph for this project.
   * Returns { graph, stats, duration }.
   */
  build({ force = false } = {}) {
    const startTime = Date.now();

    // Load existing graph if not forcing rebuild
    if (!force) {
      this.graph.load();
    } else {
      this.graph.clear();
    }

    // Step 1: Scan project structure
    const projectCtx = scanProject(this.projectDir);

    // Step 2: Analyze code
    let analysis = null;
    try {
      analysis = analyzeCodebase(this.projectDir);
    } catch {}

    // Step 3: Walk source files and build nodes + edges
    const sourceFiles = this._collectSourceFiles();
    const existingFiles = new Set();

    for (const filePath of sourceFiles) {
      const relPath = path.relative(this.projectDir, filePath).replace(/\\/g, '/');
      existingFiles.add(relPath);

      // Check if file has been modified since last build
      const existingNode = this.graph.getNodesByFile(relPath);
      if (existingNode.length > 0 && !force) {
        try {
          const stat = fs.statSync(filePath);
          const nodeTime = existingNode[0].updatedAt;
          if (nodeTime && new Date(nodeTime) >= stat.mtime) continue; // not modified
        } catch {}
      }

      // Parse the file
      this._processFile(filePath, relPath);
    }

    // Step 4: Learn from code analysis
    if (analysis) {
      this.graph.learnFromAnalysis(analysis);
      this._buildImportEdges(analysis);
    }

    // Step 5: Add project-level concept nodes
    this._addProjectConcepts(projectCtx, analysis);

    // Step 6: Connect tests to their source files
    this._connectTests(sourceFiles);

    // Step 7: Save
    this.graph.save();

    const duration = Date.now() - startTime;
    const stats = this.graph.getStats();

    return { graph: this.graph, stats, duration };
  }

  _collectSourceFiles() {
    const codeExts = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.rb', '.php']);
    const ignore = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.yuva', '.session', '__pycache__', '.venv', 'venv']);
    const files = [];

    const walk = (dir, depth = 0) => {
      if (depth > 6) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (ignore.has(entry.name)) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath, depth + 1);
          } else if (codeExts.has(path.extname(entry.name))) {
            files.push(fullPath);
          }
        }
      } catch {}
    };

    walk(this.projectDir);
    return files;
  }

  _processFile(filePath, relPath) {
    const basename = path.basename(filePath, path.extname(filePath));
    const ext = path.extname(filePath);

    // Add file node
    const fileNodeId = this.graph.addNode(NODE_TYPES.FILE, basename, {
      file: relPath,
      summary: this._summarizeFile(filePath, ext),
    });

    // Add module node for the directory
    const dir = path.dirname(relPath);
    if (dir && dir !== '.') {
      const moduleNodeId = this.graph.addNode(NODE_TYPES.MODULE, dir, {
        summary: `Module: ${dir}`,
      });
      this.graph.addEdge(moduleNodeId, fileNodeId, EDGE_TYPES.CONTAINS);
    }

    // Parse file for exports, imports, classes, functions
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      this._parseExports(content, ext, fileNodeId, relPath);
      this._parseImports(content, ext, fileNodeId, relPath);
      this._parseClasses(content, ext, fileNodeId, relPath);
    } catch {}
  }

  _parseExports(content, ext, fileNodeId, relPath) {
    if (!['.js', '.ts', '.jsx', '.tsx'].includes(ext)) return;

    const patterns = [
      { re: /module\.exports\.(\w+)/g, type: NODE_TYPES.FUNCTION },
      { re: /export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/g, type: NODE_TYPES.FUNCTION },
      { re: /export\s+(?:default\s+)?class\s+(\w+)/g, type: NODE_TYPES.CLASS },
      { re: /export\s+(?:const|let|var)\s+(\w+)/g, type: NODE_TYPES.FUNCTION },
    ];

    for (const { re, type } of patterns) {
      let m;
      while ((m = re.exec(content)) !== null) {
        if (m[1]) {
          const nodeId = this.graph.addNode(type, m[1], {
            file: relPath,
            summary: `Exported from ${relPath}`,
          });
          this.graph.addEdge(fileNodeId, nodeId, EDGE_TYPES.CONTAINS);
        }
      }
    }
  }

  _parseImports(content, ext, fileNodeId, relPath) {
    if (!['.js', '.ts', '.jsx', '.tsx'].includes(ext)) return;

    const patterns = [
      /require\s*\(\s*['"]([^'".][^'"]*)['"]\s*\)/g,
      /from\s+['"]([^'".][^'"]*)['"]/g,
    ];

    const imports = new Set();
    for (const pat of patterns) {
      let m;
      while ((m = pat.exec(content)) !== null) {
        imports.add(m[1]);
      }
    }

    for (const imp of imports) {
      // Only track relative imports (project-internal)
      if (imp.startsWith('.') || imp.startsWith('/')) {
        const resolved = this._resolveImport(imp, relPath);
        if (resolved) {
          const targetNodeId = this.graph.addNode(NODE_TYPES.FILE, path.basename(resolved), {
            file: resolved,
          });
          this.graph.addEdge(fileNodeId, targetNodeId, EDGE_TYPES.IMPORTS);
        }
      }
    }
  }

  _parseClasses(content, ext, fileNodeId, relPath) {
    const classPattern = /class\s+(\w+)(?:\s+extends\s+(\w+))?/g;
    let m;
    while ((m = classPattern.exec(content)) !== null) {
      const classNodeId = this.graph.addNode(NODE_TYPES.CLASS, m[1], {
        file: relPath,
        summary: m[2] ? `extends ${m[2]}` : '',
      });
      this.graph.addEdge(fileNodeId, classNodeId, EDGE_TYPES.CONTAINS);
    }
  }

  _buildImportEdges(analysis) {
    for (const [file, imports] of Object.entries(analysis.imports || {})) {
      const fileNodeId = this.graph._makeId(NODE_TYPES.FILE, path.basename(file), file);
      for (const imp of imports) {
        const candidates = this.graph.query(imp, { types: [NODE_TYPES.FILE, NODE_TYPES.MODULE] });
        if (candidates.length > 0) {
          this.graph.addEdge(fileNodeId, candidates[0].id, EDGE_TYPES.DEPENDS_ON);
        }
      }
    }
  }

  _addProjectConcepts(projectCtx, analysis) {
    // Add concept nodes for detected frameworks
    for (const fw of (projectCtx.frameworks || [])) {
      this.graph.addNode(NODE_TYPES.CONCEPT, `framework:${fw}`, {
        summary: `Project uses ${fw}`,
      });
    }

    // Add concept nodes for detected patterns
    if (analysis) {
      if (analysis.apiRoutes.length > 0) {
        this.graph.addNode(NODE_TYPES.CONCEPT, 'api-routes', {
          summary: `Project has ${analysis.apiRoutes.length} API routes`,
        });
      }
      if (analysis.databaseModels.length > 0) {
        this.graph.addNode(NODE_TYPES.CONCEPT, 'database-models', {
          summary: `Project has ${analysis.databaseModels.length} DB models`,
        });
      }
      if (analysis.components.length > 0) {
        this.graph.addNode(NODE_TYPES.CONCEPT, 'react-components', {
          summary: `Project has ${analysis.components.length} React components`,
        });
      }
    }
  }

  _connectTests(sourceFiles) {
    const testFiles = sourceFiles.filter(f => {
      const rel = path.relative(this.projectDir, f).replace(/\\/g, '/');
      return /\.(test|spec)\.(js|ts|jsx|tsx)$/.test(rel) ||
             /[\\/]tests?[\\/]/.test(rel) ||
             /[\\/]__tests__[\\/]/.test(rel);
    });

    for (const testFile of testFiles) {
      const relPath = path.relative(this.projectDir, testFile).replace(/\\/g, '/');
      const testNodeId = this.graph.addNode(NODE_TYPES.TEST, path.basename(relPath), {
        file: relPath,
      });

      // Try to find the source file this test tests
      const sourceGuess = relPath
        .replace(/\.(test|spec)/, '')
        .replace(/__tests__[/\\]/, '')
        .replace(/tests?[/\\]/, 'src/');

      const candidates = this.graph.query(path.basename(sourceGuess), { types: [NODE_TYPES.FILE] });
      if (candidates.length > 0) {
        this.graph.addEdge(testNodeId, candidates[0].id, EDGE_TYPES.TESTS);
        this.graph.addEdge(candidates[0].id, testNodeId, EDGE_TYPES.TESTED_BY);
      }
    }
  }

  _summarizeFile(filePath, ext) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const lineCount = lines.length;

      // Find first comment or docstring
      let firstComment = '';
      for (const line of lines.slice(0, 10)) {
        const trimmed = line.trim();
        if (trimmed.startsWith('/**') || trimmed.startsWith('//') || trimmed.startsWith('#')) {
          firstComment = trimmed.replace(/^\/\*\*?|\/\/|#+\s*/g, '').trim();
          if (firstComment.length > 5) break;
        }
      }

      return firstComment || `${lineCount} lines of ${ext.slice(1)} code`;
    } catch {
      return '';
    }
  }

  _resolveImport(importPath, fromFile) {
    const fromDir = path.dirname(fromFile);
    const resolved = path.join(fromDir, importPath).replace(/\\/g, '/');

    // Try common extensions
    const exts = ['.js', '.ts', '.jsx', '.tsx', '.json'];
    for (const ext of exts) {
      const candidate = resolved + ext;
      if (fs.existsSync(path.join(this.projectDir, candidate))) return candidate;
    }
    // Try index files
    for (const ext of exts) {
      const candidate = resolved + '/index' + ext;
      if (fs.existsSync(path.join(this.projectDir, candidate))) return candidate;
    }
    return null;
  }
}

module.exports = { GraphBuilder };
