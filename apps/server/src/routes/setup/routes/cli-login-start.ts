/**
 * POST /cli-login/start endpoint - Start CLI login and return verification URL/code
 */

import type { Request, Response } from 'express';
import { spawn, type ChildProcess } from 'child_process';
import * as pty from 'node-pty';
import { createLogger } from '@automaker/utils';
import { getErrorMessage, logError } from '../common.js';
import { CursorProvider } from '../../../providers/cursor-provider.js';
import { findCodexCliPath } from '@automaker/platform';

const logger = createLogger('Setup');

type CliLoginProvider = 'claude' | 'codex' | 'cursor' | 'opencode';

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const INITIAL_OUTPUT_TIMEOUT_MS = 2000;
const MAX_CAPTURED_OUTPUT = 12000;

interface LoginSession {
  process: { kill: (signal?: string) => void };
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

function stripAnsi(text: string): string {
  return text.replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-9;]*[A-Za-z]/g,
    ''
  );
}

function parseLoginOutput(text: string): { verificationUrl?: string; userCode?: string } {
  const verificationUrl =
    text.match(/https?:\/\/[^\s"')>]+\/codex\/device/i)?.[0] ||
    text.match(/https?:\/\/[^\s"')>]+\/device/i)?.[0] ||
    text.match(/https?:\/\/[^\s"')>]+/)?.[0];

  const codeCandidates = [
    ...text.matchAll(/\b[A-Z0-9]{4,}-[A-Z0-9]{4,}\b/g),
    ...text.matchAll(/\b[A-Z0-9]{8,}\b/g),
  ].map((m) => m[0]);

  const userCode = codeCandidates.length > 0 ? codeCandidates[codeCandidates.length - 1] : undefined;

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

  if (provider === 'opencode') {
    return {
      command: 'opencode',
      args: ['auth', 'login'],
      displayCommand: 'opencode auth login',
    };
  }

  return { command: 'claude', args: ['login'], displayCommand: 'claude login' };
}

export function createCliLoginStartHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    const { provider } = req.body as { provider?: CliLoginProvider };

    if (!provider || !['claude', 'codex', 'cursor', 'opencode'].includes(provider)) {
      res.status(400).json({
        success: false,
        error: 'Invalid provider. Expected one of: claude, codex, cursor, opencode.',
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

      const usePty = provider === 'claude';
      const ptyEnv = {
        ...env,
        TERM: 'xterm-256color',
      };
      const child = usePty
        ? pty.spawn(command, args, {
            cwd: process.cwd(),
            env: ptyEnv,
            name: 'xterm-256color',
            cols: 80,
            rows: 24,
          })
        : spawn(command, args, {
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

      const maybeResolve = (force: boolean = false) => {
        if (resolved) return;
        const cleanedOutput = stripAnsi(output);
        const { verificationUrl, userCode } = parseLoginOutput(cleanedOutput);
        if (verificationUrl || userCode || cleanedOutput.length > 0 || force) {
          resolved = true;
          res.json({
            success: true,
            sessionId,
            provider,
            verificationUrl,
            userCode,
            command: displayCommand,
            output: cleanedOutput,
          });
        }
      };

      const initialOutputTimer = setTimeout(() => {
        maybeResolve(true);
      }, INITIAL_OUTPUT_TIMEOUT_MS);

      const handleData = (data: Buffer) => {
        output = captureOutput(output, data.toString());
        const cleanedOutput = stripAnsi(output);
        const session = activeLoginSessions.get(sessionId);
        if (session) {
          session.output = cleanedOutput;
        }
        const { verificationUrl, userCode } = parseLoginOutput(cleanedOutput);
        if (verificationUrl || userCode) {
          clearTimeout(initialOutputTimer);
          maybeResolve();
        }
      };

      if (usePty) {
        child.onData((data: string) => handleData(Buffer.from(data)));
        setTimeout(() => {
          try {
            child.write('\n');
          } catch {
            // Ignore write errors
          }
        }, 200);
        child.onExit(({ exitCode }) => {
          if (!resolved) {
            res.json({
              success: false,
              sessionId,
              provider,
              error: `Login process exited with code ${exitCode ?? 'unknown'}`,
              command: displayCommand,
              output: stripAnsi(output),
            });
          }
          cleanup();
        });
      } else {
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
              output: stripAnsi(output),
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
              output: stripAnsi(output),
            });
          }
          cleanup();
        });
      }
    } catch (error) {
      logError(error, 'Start CLI login failed');
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  };
}
