/**
 * Types for the post-deploy check, which is plain JavaScript so that CI can
 * run it with `node` and nothing else. Only the two entry points the tests
 * use are declared.
 */

/** The deploy URL out of the JSON `netlify deploy --json` prints, or null. */
export function findDeployUrl(text: string): string | null

/** Every check against one site. Resolves to whether the deploy is serving. */
export function runChecks(
  url: string,
  options?: { retries?: number; retryDelayMs?: number },
): Promise<boolean>
