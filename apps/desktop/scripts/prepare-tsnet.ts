/** Build the pinned official tsnet helper and retain its dependency licenses in Desktop resources. */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { desktopTargetPlatform, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'

const execute = promisify(execFile)
const source = resolve(import.meta.dirname, '../tsnet')

/**
 * Compile the helper for the selected Desktop payload without requiring Go on end-user machines.
 * @param environment Packaging target and optional DSH_DESKTOP_GO_BINARY compiler path.
 * @returns Directory copied intact into the application resources.
 */
export async function prepareDesktopTsnet(environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  const target = desktopTargetPlatform(resolveDesktopBuildTarget(environment))
  const output = join(resolveDesktopTargetBuildPaths(environment).root, 'tsnet')
  const go = environment.DSH_DESKTOP_GO_BINARY ?? 'go'
  const module = await readFile(join(source, 'go.mod'), 'utf8')
  const version = /tailscale\.com v([^\s]+)/u.exec(module)?.[1]
  if (version === undefined) throw new Error('desktop tsnet: tailscale.com must be pinned in go.mod')
  const env = { ...environment, CGO_ENABLED: '0', GOOS: target.platform === 'win32' ? 'windows' : 'darwin',
    GOARCH: target.arch === 'x64' ? 'amd64' : target.arch }
  const options = { cwd: source, env, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
  await mkdir(output, { recursive: true })
  await execute(go, ['mod', 'verify'], options)
  const executable = join(output, target.platform === 'win32' ? 'dsh-tsnet.exe' : 'dsh-tsnet')
  await execute(go, ['build', '-trimpath', '-buildvcs=false', `-ldflags=-s -w -X main.tailscaleVersion=${version}`, '-o', executable, '.'], options)
  const dependencyList = await execute(go, ['list', '-deps', '-f', '{{if .Module}}{{.Module.Path}}|{{.Module.Dir}}{{end}}', '.'], options)
  const modules = new Map(dependencyList.stdout.split('\n').filter(line => line.includes('|')).map((line) => {
    const separator = line.indexOf('|')
    return [line.slice(0, separator), line.slice(separator + 1)]
  }))
  const notices: string[] = []
  for (const [name, directory] of [...modules].sort(([left], [right]) => left.localeCompare(right))) {
    if (directory === source) continue
    const files = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile()
      && /^(?:licen[sc]e|copying|notice|copyright)(?:[.-].*)?$/iu.test(entry.name))
    if (files.length === 0) throw new Error(`desktop tsnet: missing dependency license for ${name}`)
    for (const file of files) notices.push(`${name} / ${file.name}\n${await readFile(join(directory, file.name), 'utf8')}`)
  }
  await writeFile(join(output, 'THIRD_PARTY_LICENSES.txt'), `${notices.join('\n\n')}\n`)
  await writeFile(join(output, 'version.json'), `${JSON.stringify({ protocolVersion: 1, tailscaleVersion: version,
    platform: target.platform, arch: target.arch,
    unsignedSha256: createHash('sha256').update(await readFile(executable)).digest('hex') }, null, 2)}\n`)
  console.log(`desktop tsnet: tailscale.com ${version}, ${target.platform}-${target.arch}, ${output}`)
  return output
}

if (import.meta.main) await prepareDesktopTsnet()
