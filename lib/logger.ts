import fs from 'fs';

export interface LoggerOptions {
  verbose?: boolean;
  logFile?: string | null;
  silent?: boolean;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

class Logger {
  verbose: boolean;
  logFile: string | null;
  silent: boolean;

  constructor(options: LoggerOptions = {}) {
    this.verbose = options.verbose || false;
    this.logFile = options.logFile || null;
    this.silent = options.silent || false;
  }

  _write(level: LogLevel, message: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] ${message}`;

    if (this.logFile) {
      fs.appendFileSync(this.logFile, logEntry + '\n');
    }

    if (!this.silent && (this.verbose || level !== 'DEBUG')) {
      if (level === 'ERROR') console.error(logEntry);
      else if (level === 'WARN') console.warn(logEntry);
    }
  }

  debug(message: string): void { this._write('DEBUG', message); }
  info(message: string): void { this._write('INFO', message); }
  warn(message: string): void { this._write('WARN', message); }
  error(message: string): void { this._write('ERROR', message); }
}

let instance: Logger | null = null;

function getLogger(options?: LoggerOptions): Logger {
  if (!instance) {
    instance = new Logger(options);
  }
  return instance;
}

export { Logger, getLogger };
