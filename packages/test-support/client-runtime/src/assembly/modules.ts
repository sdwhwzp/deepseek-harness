/**
 * In-process module arrival: import every roster row's `/client` module (or
 * the plan's replacement) and register each as a pre-arrived factory on a
 * production `ClientModuleSystem`, so neither the Loader's `internal.import`
 * nor a stage-one `prefetch` ever fetches a bundle.
 * @module @deepseek-ai/dsh-client-test-runtime/src/assembly/modules
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { sep } from 'node:path'
import { compileFunction } from 'node:vm'
import * as modulesClient from '@deepseek-ai/dsh-client-modules/client'
import { createClientModuleSystem } from '@deepseek-ai/dsh-client-modules/client'
import type { ClientBundleRegistration, ClientModuleLoader, ClientModuleLoaderTarget, WebBootGraph } from '@deepseek-ai/dsh-client-modules/client'
import { getStaticModules } from '@deepseek-ai/dsh-client-web/src/seed.ts'
import type { AssemblyPlan, ClientPluginModule } from './roster.ts'

/** A source namespace or an installed browser bundle awaiting materialization. */
export type ClientModuleSource = ClientPluginModule | ClientBundleRegistration

/** The bootstrap row: always this process's static namespace, never a dynamic import or a `provide` replacement. */
export const MODULES_PACKAGE = '@deepseek-ai/dsh-client-modules'

/**
 * Resolve each roster row to its plugin module: `plan.provide[name]` when
 * present, otherwise a `/client` import resolved by the repository's tsconfig
 * path aliases under Vitest. The bootstrap row is the
 * statically imported `@deepseek-ai/dsh-client-modules/client` namespace.
 * @param plan - validated plan.
 * @returns package name → module, in roster order.
 * @throws {Error} when an import fails (the package name prefixes the original message) or the bootstrap row is provided.
 */
export async function loadPluginModules(plan: AssemblyPlan): Promise<ReadonlyMap<string, ClientModuleSource>> {
  const modules = new Map<string, ClientModuleSource>()
  for (const { name } of plan.roster.rows) {
    const provided = plan.provide?.[name]
    if (name === MODULES_PACKAGE) {
      if (provided !== undefined) {
        throw new Error(`client-test-runtime: ${MODULES_PACKAGE} is the bootstrap module and cannot be provided`)
      }
      modules.set(name, modulesClient)
      continue
    }
    modules.set(name, provided ?? await importClient(name))
  }
  return modules
}

async function importClient(name: string): Promise<ClientModuleSource> {
  let namespace: unknown
  try {
    let resolved: string | undefined
    try {
      resolved = createRequire(import.meta.url).resolve(`${name}/client`)
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'MODULE_NOT_FOUND') throw error
    }
    if (resolved?.includes(`${sep}node_modules${sep}`)) {
      const source = await readFile(resolved, 'utf8')
      if (/^\s*window\.__ModuleLoader__\.load\(/.test(source)) return captureClientBundle(name, source)
    }
    namespace = await import(/* @vite-ignore */ `${name}/client`)
  } catch (error) {
    throw new Error(`client-test-runtime: cannot import ${name}/client: ${String(error)}`, { cause: error })
  }
  return namespace as ClientPluginModule
}

/**
 * Capture one trusted installed entry without replacing the page's loader.
 * @param name - expected package id.
 * @param source - browser registration script beginning with the loader call.
 * @returns the deferred factory, retaining the page globals used by its body.
 */
export function captureClientBundle(name: string, source: string): ClientBundleRegistration {
  const prefix = /^\s*window\.__ModuleLoader__\.load\(/
  if (!prefix.test(source)) throw new Error(`client-test-runtime: ${name} has no browser registration`)
  const registrations: ClientBundleRegistration[] = []
  const register = (registration: ClientBundleRegistration): void => { registrations.push(registration) }
  const execute = compileFunction(source.replace(prefix, 'register('), ['register']) as (submit: typeof register) => void
  execute(register)
  const registration = registrations[0]
  if (registrations.length !== 1 || registration?.id !== name || registration.chunk !== undefined
    || typeof registration.factory !== 'function') {
    throw new Error(`client-test-runtime: ${name} must register exactly its entry factory`)
  }
  return registration
}

/**
 * Build the production module system over queued factories returning the
 * loaded namespaces or installed browser factories. The bootstrap row uses
 * `bootstrapModule`; browser factories share the production platform seeds. Missing factories
 * reject through `loadBundle` without fetching.
 * @param graph - raw boot graph from `graphFromRoster`; `createClientModuleSystem` parses it.
 * @param modules - loaded plugin modules keyed by package name.
 * @returns module system to install as `loader.internal`; its `manifest` is the parsed graph.
 */
export function createInProcessModules(
  graph: WebBootGraph,
  modules: ReadonlyMap<string, ClientModuleSource>,
): ClientModuleLoader {
  const target: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue: [],
    /* v8 ignore next -- construction replaces this sink before draining the prefilled queue. */
    load: () => { throw new Error('client-test-runtime: module facade is not initialized') },
    create: options => createClientModuleSystem(target, { id: MODULES_PACKAGE, exports: modulesClient }, options),
  }
  for (const [id, namespace] of modules) {
    if (id === MODULES_PACKAGE) continue
    target.pendingQueue.push('factory' in namespace ? namespace : {
      id,
      factory: () => {
        const exports: unknown = namespace
        return exports as Record<string, unknown>
      },
    })
  }
  return target.create({
    boot: graph,
    staticModules: getStaticModules(),
    loadBundle: url => Promise.reject(new Error(`client-test-runtime: in-process modules never load bundles (${url})`)),
  })
}
