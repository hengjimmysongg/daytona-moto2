/**
 * The API, minus the host.
 *
 * Netlify and Vercel both hand a function a `Request` and want a `Response`
 * back, so everything an adapter does either side of that — read the
 * environment, refuse to run without a database, open one — is the same
 * work written twice. It lives here instead, and each adapter is left with
 * the one thing only it can know: whether this is a developer's own machine
 * or a deployment.
 */

import { getDb, isRemoteUrl, readDbConfig } from './db.js'
import { handleApiRequest, json } from './router.js'

export interface HostContext {
  /**
   * True on a developer's own machine, false on a deployment. It decides
   * only whether a SQLite file counts as a database: on a laptop it is one,
   * on a serverless host it is a filesystem about to be thrown away. An
   * adapter that cannot tell should say false.
   */
  isLocal: boolean
  /** Defaults to this process's environment; injected by the tests. */
  env?: Record<string, string | undefined>
}

export async function serveApiRequest(request: Request, host: HostContext): Promise<Response> {
  const env = host.env ?? process.env
  const config = readDbConfig(env)

  // A deployed function's filesystem is read-only, and what it can write is
  // thrown away with the container. A `file:` database there is not a
  // database — it is a 500 on the first write, or worse, a log that appears
  // to save and is gone by the next request. Say so up front instead.
  if (!host.isLocal && !isRemoteUrl(config.url)) {
    return json(
      {
        error:
          'This deployment has no database configured, so it will not serve data. ' +
          "Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the deployment's environment and redeploy.",
        help: 'turso db create trackday && turso db show trackday --url',
      },
      503,
    )
  }

  const db = await getDb(env)
  return handleApiRequest(request, { db })
}
