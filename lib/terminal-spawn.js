const { spawn } = require('child_process');

/**
 * Build the platform-specific spec for opening a new terminal window that
 * runs `command` in `cwd`. Pure function — testable without side effects.
 * NOTE: `command` must not contain double quotes (shell-quoting safety);
 * spawned commands are yuva CLI invocations, which never need them.
 */
function buildSpawnSpec(platform, command, { title = 'Yuva', cwd = process.cwd() } = {}) {
  if (platform === 'win32') {
    return {
      cmd: `start "${title}" /D "${cwd}" cmd /k "${command}"`,
      args: [],
      options: { shell: true, detached: true, stdio: 'ignore' },
    };
  }

  if (platform === 'darwin') {
    const script = `tell application "Terminal" to do script "cd ${cwd} && ${command}"`;
    return {
      cmd: 'osascript',
      args: ['-e', script],
      options: { detached: true, stdio: 'ignore' },
    };
  }

  // Linux: try common terminal emulators in order
  const inner = `cd '${cwd}' && ${command}; exec bash`;
  const attempts = [
    `x-terminal-emulator -e bash -lc "${inner}"`,
    `gnome-terminal -- bash -lc "${inner}"`,
    `konsole -e bash -lc "${inner}"`,
    `xterm -e bash -lc "${inner}"`,
  ].join(' || ');
  return {
    cmd: 'sh',
    args: ['-c', `(${attempts}) >/dev/null 2>&1 &`],
    options: { detached: true, stdio: 'ignore' },
  };
}

/** Open a new terminal window running `command`. Returns true on launch. */
function openTerminal(command, opts = {}) {
  if (command.includes('"')) {
    throw new Error('openTerminal commands must not contain double quotes');
  }
  const spec = buildSpawnSpec(process.platform, command, opts);
  try {
    const child = spawn(spec.cmd, spec.args, spec.options);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

module.exports = { buildSpawnSpec, openTerminal };
