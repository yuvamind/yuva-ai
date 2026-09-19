const path = require('path');
const fs = require('fs');
const { log, box, success, warn, error, info } = require('../colors');
const { fileExists, writeFile, ensureDir } = require('../fs-utils');
const { validateAgentName } = require('../validator');
const P = require('../paths');

const AGENT_TEMPLATE = `# {{NAME}} Agent

## Role
You are the **{{NAME}} Agent**, a specialized assistant for {{PURPOSE}}.

## Activation
This agent is activated when the user's request involves:
- {{KEYWORD1}}
- {{KEYWORD2}}
- {{KEYWORD3}}

## Capabilities
1. **Core Capability 1** - Description
2. **Core Capability 2** - Description
3. **Core Capability 3** - Description

## Rules
1. Always introduce yourself as the {{NAME}} Agent
2. Stay within your domain of expertise
3. Hand off to other agents when the task is outside your scope
4. Provide actionable, specific guidance
5. Include appropriate disclaimers when needed

## Output Format
- Use clear, structured responses
- Include step-by-step guidance when appropriate
- Summarize key points at the end
- Suggest follow-up actions

## Response Flow
1. Acknowledge the user's request
2. Ask clarifying questions if needed
3. Provide detailed guidance
4. Summarize and suggest next steps
`;

function addCommand(args = []) {
  const action = args[0];

  if (!action) {
    box('Yuva AI - Agent Management');
    log('Usage:', 'bright');
    log('   yuva add create <name>     Create a new custom agent');
    log('   yuva add remove <name>     Remove an agent');
    log('   yuva add <name>            Install a community agent\n');
    return;
  }

  const targetDir = process.cwd();

  if (action === 'create') {
    return createAgent(args.slice(1), targetDir);
  }

  if (action === 'remove') {
    return removeAgent(args.slice(1), targetDir);
  }

  info(`Community agent registry coming soon. Use "yuva add create ${action}" to create a custom agent.\n`);
}

function createAgent(args, targetDir) {
  const name = args[0];
  const validation = validateAgentName(name);
  if (!validation.valid) {
    error(validation.error);
    return;
  }

  const promptsDir = P.promptsDir(targetDir);
  const fileName = `${name}agent.md`;
  const filePath = path.join(promptsDir, fileName);

  if (fileExists(filePath)) {
    warn(`Agent "${name}" already exists at ${fileName}`);
    return;
  }

  ensureDir(promptsDir);

  const content = AGENT_TEMPLATE
    .replace(/\{\{NAME\}\}/g, name.charAt(0).toUpperCase() + name.slice(1))
    .replace(/\{\{PURPOSE\}\}/g, `${name}-related tasks`)
    .replace('{{KEYWORD1}}', `${name}`)
    .replace('{{KEYWORD2}}', `${name}-related topics`)
    .replace('{{KEYWORD3}}', `Help with ${name}`);

  writeFile(filePath, content);

  // Create agent config
  const configDir = P.agentConfigDir(targetDir);
  ensureDir(configDir);
  const configPath = path.join(configDir, `${name}.json`);
  const config = {
    name: name,
    version: '1.0.0',
    type: 'custom',
    category: 'custom',
    triggers: [name],
    description: `Custom ${name} agent`,
    file: fileName,
    dependencies: [],
    created: new Date().toISOString()
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  success(`Created agent "${name}"`);
  log(`   Prompt: .yuva/prompts/${fileName}`);
  log(`   Config: .yuva/agents/${name}.json`);
  log(`\n   Edit the prompt file to customize your agent.`);
  log(`   Agent will be auto-detected by yuva agent show ${name}.\n`);
}

function removeAgent(args, targetDir) {
  const name = args[0];
  if (!name) {
    error('Agent name required. Usage: yuva add remove <name>');
    return;
  }

  const promptsDir = P.promptsDir(targetDir);
  const fileName = `${name}agent.md`;
  const filePath = path.join(promptsDir, fileName);

  const altPath = path.join(promptsDir, `${name}.md`);
  const actualPath = fileExists(filePath) ? filePath : (fileExists(altPath) ? altPath : null);

  if (!actualPath) {
    error(`Agent "${name}" not found`);
    return;
  }

  fs.unlinkSync(actualPath);

  const configPath = path.join(P.agentConfigDir(targetDir), `${name}.json`);
  if (fileExists(configPath)) {
    fs.unlinkSync(configPath);
  }

  success(`Removed agent "${name}"\n`);
}

module.exports = addCommand;
