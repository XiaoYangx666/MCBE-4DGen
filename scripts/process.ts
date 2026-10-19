import type { ChildProcess } from 'node:child_process';

/** Resolve a child's exit code; null means it was terminated by a signal. */
export function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(child.exitCode);
  return new Promise<number | null>((resolve, reject) => {
    const cleanup = () => {
      child.off('exit', onExit);
      child.off('error', onError);
    };
    const onExit = (code: number | null) => {
      cleanup();
      resolve(code);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    child.once('exit', onExit);
    child.once('error', onError);
  });
}
