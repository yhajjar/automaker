/**
 * POST /cli-login/start endpoint - Start CLI login and return verification URL/code
 */

import type { Request, Response } from 'express';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createLogger } from '@automaker/utils';
import { getErrorMessage, logError } from '../common.js';
import { CursorProvider } from '../../../providers/cursor-provider.js';
import { findCodexCliPath } from '@automaker/platform';

const logger = createLogger('Setup');

type CliLoginProvider = 'claude' | 'codex' | 'cursor';

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const INITIAL_OUTPUT_TIMEOUT_MS = 2000;
const MAX_CAPTURED_OUTPUT = 12000;

interface LoginSession {
  process: ChildProcessWithoutNullStreams;
  provider: CliLoginProvider;
  output: string;
  startedAt: number;
  timeout: NodeJS.Timeout;
}

const activeLoginSessions = new Map<string, LoginSession>();

function captureOutput(current: string, chunk: string): string {
  let next = current + chunk;
  if (next.length > MAX_CAPTURED_OUTPUT) {
    next = next.slice(next.length - MAX_CAPTURED_OUTPUT);
  }
  return next;
}

function parseLoginOutput(text: string): { verificationUrl?: string; userCode?: string } {
  const urlMatch = text.match(/https?:\/\/[^\s"')>]+/);
  const verificationUrl = urlMatch?.[0];

  // Try to find a code near the word "code" or "device code"
  const codeMatch =
    text.match(/code[^A-Z0-9]*([A-Z0-9-]{6,})/i) ||
    text.match(/([A-Z0-9]{4,}-[A-Z0-9]{4,})/);
  const userCode = codeMatch?.[1];

  return { verificationUrl, userCode };
}

async function resolveCommand(provider: CliLoginProvider): Promise<{
  command: string;
  args: string[];
  displayCommand: string;
}> {
  if (provider === 'cursor') {
    const cursorProvider = new CursorProvider();
    const cliPath = cursorProvider.getCliPath();
    if (cliPath) {
      if (cliPath.includes('cursor-agent')) {
        return { command: cliPath, args: ['login'], displayCommand: 'cursor-agent login' };
      }
      return { command: cliPath, args: ['agent', 'login'], displayCommand: 'cursor agent login' };
    }
    return { command: 'cursor-agent', args: ['login'], displayCommand: 'cursor-agent login' };
  }

  if (provider === 'codex') {
    const codexPath = await findCodexCliPath();
    if (codexPath) {
      return { command: codexPath, args: ['login'], displayCommand: 'codex login' };
    }
    return { command: 'codex', args: ['login'], displayCommand: 'codex login' };
  }

  return { command: 'claude', args: ['login'], displayCommand: 'claude login' };
}

export function createCliLoginStartHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    const { provider } = req.body as { provider?: CliLoginProvider };

    if (!provider || !['claude', 'codex', 'cursor'].includes(provider)) {
      res.status(400).json({
        success: false,
        error: 'Invalid provider. Expected one of: claude, codex, cursor.',
      });
      return;
    }

    try {
      const { command, args, displayCommand } = await resolveCommand(provider);
      const sessionId = `login-${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const env = {
        ...process.env,
        BROWSER: 'echo',
        TERM: 'dumb',
        NO_COLOR: '1',
      };

      logger.info(`[Setup] Starting ${provider} login via: ${command} ${args.join(' ')}`);

      const child = spawn(command, args, {
        cwd: process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      let resolved = false;

      const cleanup = () => {
        const session = activeLoginSessions.get(sessionId);
        if (session) {
          clearTimeout(session.timeout);
          activeLoginSessions.delete(sessionId);
        }
      };

      const timeout = setTimeout(() => {
        logger.warn(`[Setup] Login session timed out: ${sessionId}`);
        try {
          child.kill('SIGTERM');
        } catch {
          // Ignore kill errors
        }
        cleanup();
      }, LOGIN_TIMEOUT_MS);

      activeLoginSessions.set(sessionId, {
        process: child,
        provider,
        output: '',
        startedAt: Date.now(),
        timeout,
      });

      const maybeResolve = () => {
        if (resolved) return;
        const { verificationUrl, userCode } = parseLoginOutput(output);
        if (verificationUrl || userCode || output.length > 0) {
          resolved = true;
          res.json({
            success: true,
            sessionId,
            provider,
            verificationUrl,
            userCode,
            command: displayCommand,
            output,
          });
        }
      };

      const initialOutputTimer = setTimeout(() => {
        maybeResolve();
      }, INITIAL_OUTPUT_TIMEOUT_MS);

      const handleData = (data: Buffer) => {
        output = captureOutput(output, data.toString());
        const session = activeLoginSessions.get(sessionId);
        if (session) {
          session.output = output;
        }
        const { verificationUrl, userCode } = parseLoginOutput(output);
        if (verificationUrl || userCode) {
          clearTimeout(initialOutputTimer);
          maybeResolve();
        }
      };

      child.stdout.on('data', handleData);
      child.stderr.on('data', handleData);

      child.on('exit', (code) => {
        if (!resolved) {
          res.json({
            success: false,
            sessionId,
            provider,
            error: `Login process exited with code ${code ?? 'unknown'}`,
            command: displayCommand,
            output,
          });
        }
        cleanup();
      });

      child.on('error', (error) => {
        clearTimeout(initialOutputTimer);
        if (!resolved) {
          res.status(500).json({
            success: false,
            provider,
            error: getErrorMessage(error),
            command: displayCommand,
            output,
          });
        }
        cleanup();
      });
    } catch (error) {
      logError(error, 'Start CLI login failed');
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  };
}
