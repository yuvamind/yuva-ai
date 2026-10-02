/** A passing result carries no `error`, which is why the field is optional. */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

function validateAgentName(name: string | null | undefined): ValidationResult {
  if (!name) return { valid: false, error: 'Agent name is required' };
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return { valid: false, error: 'Agent name must start with a letter and contain only lowercase letters, numbers, and hyphens' };
  }
  if (name.length > 50) return { valid: false, error: 'Agent name must be 50 characters or less' };
  return { valid: true };
}

function validateCommand(command: string, validCommands: string[]): ValidationResult {
  if (!command) return { valid: false, error: 'No command provided' };
  if (!validCommands.includes(command)) {
    return { valid: false, error: `Unknown command: ${command}. Valid commands: ${validCommands.join(', ')}` };
  }
  return { valid: true };
}

export { validateAgentName, validateCommand };