const { spawn, spawnSync } = require('child_process');

/**
 * Build the platform-specific spec for opening a new terminal window that
 * runs `command` in `cwd`. Pure function — testable without side effects.
 *
 * NOTE: `command` must not contain double quotes (shell-quoting safety);
 * spawned commands are yuva CLI invocations, which never need them.
 *
 * On Windows the arguments are passed as a real argv array rather than one
 * pre-quoted string. `spawn(..., {shell:true})` runs `cmd.exe /d /s /c "..."`,
 * and `/s` strips only the OUTERMOST quote pair — so a hand-built
 * `start "title" /D "dir" cmd /k "command"` string loses its nested quoting
 * and the command arrives mangled.
 */
function buildSpawnSpec(platform, command, { title = 'Yuva', cwd = process.cwd(), terminal = null } = {}) {
  if (platform === 'win32') {
    // Windows Terminal, when present, gives a real tab per worker instead of
    // a scattering of legacy console windows.
    if (terminal === 'wt') {
      return {
        cmd: 'wt.exe',
        args: ['-w', '0', 'new-tab', '--title', title, '-d', cwd, 'cmd.exe', '/k', command],
        options: { detached: true, stdio: 'ignore', windowsVerbatimArguments: false },
      };
    }
    return {
      cmd: 'cmd.exe',
      args: ['/c', 'start', title, '/D', cwd, 'cmd.exe', '/k', command],
      options: { detached: true, stdio: 'ignore' },
    };
  }

  if (platform === 'darwin') {
    // Escape backslashes first, then double quotes, for osascript
    const safeCwd = cwd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const safeCmd = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `tell application "Terminal" to do script "cd ${safeCwd} && ${safeCmd}"`;
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

/** True when Windows Terminal is installed and usable. */
function hasWindowsTerminal() {
  if (process.platform !== 'win32') return false;
  try {
    return spawnSync('where', ['wt.exe'], { stdio: 'ignore', windowsHide: true }).status === 0;
  } catch {
    return false;
  }
}

/**
 * Open a new terminal window running `command`.
 *
 * Resolves to true only once the launcher process has actually started.
 * `spawn` throws synchronously only for immediate failures (missing binary),
 * so a window that fails to appear surfaces later as an `error` event or a
 * non-zero exit — both of which a plain try/catch would miss, which is why
 * the old version reported success for terminals that never opened.
 */
function openTerminal(command, opts = {}) {
  if (command.includes('"')) {
    throw new Error('openTerminal commands must not contain double quotes');
  }

  const terminal = opts.terminal || (hasWindowsTerminal() ? 'wt' : null);
  const spec = buildSpawnSpec(process.platform, command, { ...opts, terminal });

  return new Promise((resolve) => {
    let settled = false;
    const done = (ok, reason = null) => {
      if (settled) return;
      settled = true;
      resolve({ ok, reason, terminal });
    };

    let child;
    try {
      child = spawn(spec.cmd, spec.args, spec.options);
    } catch (err) {
      return done(false, err.message);
    }

    child.on('error', (err) => done(false, err.message));
    child.on('exit', (code) => {
      // The launcher exits immediately after handing off to the new window;
      // a non-zero code means the window never opened.
      if (code !== 0) done(false, `launcher exited with code ${code}`);
      else done(true);
    });

    // Nothing failed within the handoff window — treat the launch as good.
    const timer = setTimeout(() => {
      child.unref();
      done(true);
    }, 1500);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

module.exports = { buildSpawnSpec, openTerminal, hasWindowsTerminal };
