/** Validate the assembled application, including native Office conversion outside ASAR. */
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { desktopArtifactOutput, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { verifyWindowsCode } from './windows-runtime-signature.mjs'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'
import { resolveDesktopPackageTarget } from './package-target.ts'

const paths = resolveDesktopTargetBuildPaths()
const { values } = parseArgs({ options: { unsigned: { type: 'boolean', default: false }, 'skip-notarization': { type: 'boolean', default: false }, portable: { type: 'boolean', default: false } }, allowPositionals: false })
const target = resolveDesktopBuildTarget()
const windows = target === 'win-x64'
const artifacts = desktopArtifactOutput(paths, { unsigned: values.unsigned, skipNotarization: values['skip-notarization'], portable: values.portable }).directory
const application = windows ? join(artifacts, 'win-unpacked')
  : join(artifacts, target === 'mac-arm64' ? 'mac-arm64' : 'mac', 'DeepSeek Harness.app', 'Contents')
const resources = join(application, windows ? 'resources' : 'Resources')
const executable = windows ? join(application, 'DeepSeek Harness.exe') : join(application, 'MacOS', 'DeepSeek Harness')
const tsnet = join(resources, 'tsnet', windows ? 'dsh-tsnet.exe' : 'dsh-tsnet')
const tsnetVersion = await promisify(execFile)(tsnet, ['--version'], { windowsHide: true, timeout: 10_000 })
const tsnetMetadata: unknown = JSON.parse(await readFile(join(resources, 'tsnet', 'version.json'), 'utf8'))
if (typeof tsnetMetadata !== 'object' || tsnetMetadata === null || !('protocolVersion' in tsnetMetadata)
  || tsnetMetadata.protocolVersion !== 1 || !('tailscaleVersion' in tsnetMetadata) || typeof tsnetMetadata.tailscaleVersion !== 'string'
  || tsnetVersion.stdout.trim() !== `dsh-tsnet protocol=1 tailscale=${tsnetMetadata.tailscaleVersion}`) {
  throw new Error('desktop tsnet: invalid bundled helper')
}
const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version,
  resolveDesktopPackageTarget(target))
if (windows && !values.unsigned) await verifyWindowsCode(application)
await smokePreparedRuntime(join(resources, 'app.asar', 'dsh'), executable, join(resources, 'runtime'), descriptor)
