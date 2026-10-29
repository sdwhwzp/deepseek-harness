import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExecFileOptions } from 'node:child_process'
import {
  DESKTOP_BUILD_COMMIT_ENV,
  DESKTOP_BUILD_DIRTY_ENV,
  desktopBuildCommitEnvironment,
  readDesktopBuildCommit,
  resolveDesktopBuildCommit,
} from '../scripts/desktop-build-commit.mjs'
import { probeDesktopToolchain } from '../scripts/desktop-toolchain-preflight.ts'

const { goVersion } = vi.hoisted(() => ({
  goVersion: vi.fn(async (_file: string, _options: ExecFileOptions) => ({
    stdout: 'go version go1.27.3 test/arch', stderr: '',
  })),
}))

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  const execute = promisify(original.execFile)
  return { ...original, execFile: Object.assign(vi.fn(), {
    [promisify.custom]: (file: string, args: readonly string[], options: ExecFileOptions) =>
      args.length === 1 && args[0] === 'version' ? goVersion(file, options) : execute(file, args, options),
  }) }
})

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const directories: string[] = []

afterEach(async () => {
  goVersion.mockReset()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe('desktop build commit', () => {
  it('reads nothing outside a packaging run', () => {
    expect(resolveDesktopBuildCommit({})).toBeUndefined()
    expect(resolveDesktopBuildCommit({ [DESKTOP_BUILD_COMMIT_ENV]: '  ' })).toBeUndefined()
  })

  it('round-trips a commit and its tree state through a child environment', () => {
    for (const dirty of [true, false]) {
      expect(resolveDesktopBuildCommit(desktopBuildCommitEnvironment({ commit: COMMIT, dirty })))
        .toEqual({ commit: COMMIT, dirty })
    }
  })

  it.each(['abc', `${COMMIT}0`, 'Z'.repeat(40)])('rejects %j, which is not a commit hash', (commit) => {
    expect(() => resolveDesktopBuildCommit({ [DESKTOP_BUILD_COMMIT_ENV]: commit })).toThrow(/must be a commit hash/u)
  })

  it('rejects a tree state that is neither 0 nor 1', () => {
    expect(() => resolveDesktopBuildCommit({ [DESKTOP_BUILD_COMMIT_ENV]: COMMIT, [DESKTOP_BUILD_DIRTY_ENV]: 'yes' }))
      .toThrow(/must be 0 or 1/u)
  })

  it('reads the checkout this repository is in', () => {
    const packaged = readDesktopBuildCommit(join(import.meta.dirname, '..', '..', '..'))
    expect(packaged.commit).toMatch(/^[0-9a-f]{40}$/u)
    expect(typeof packaged.dirty).toBe('boolean')
  })
})

describe('desktop toolchain preflight', () => {
  it('passes on a host that can read archives', async () => {
    expect(await probeDesktopToolchain('darwin', {})).toEqual([])
  })

  it('reports the archive reader when it cannot run', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'dsh-no-tools-'))
    directories.push(empty)
    const saved = { PATH: process.env.PATH, Path: process.env.Path }
    try {
      Object.assign(process.env, { PATH: empty, Path: empty })
      const failures = await probeDesktopToolchain('darwin', {})
      expect(failures.map(failure => failure.tool)).toEqual(['tar'])
      expect(failures[0]?.detail).not.toBe('')
    }
    finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = value
      }
    }
  })

  it('reports the Windows installer compiler when the host cannot locate Visual Studio', async () => {
    const failures = await probeDesktopToolchain('win32', {})
    expect(failures.map(failure => failure.tool)).toContain('vswhere')
    expect(failures.find(failure => failure.tool === 'vswhere')?.detail).toContain('ProgramFiles(x86)')
  })

  it.each(['go1.26.9', 'go1.27.2', 'unexpected output'])('rejects unsupported Go output: %s', async (version) => {
    goVersion.mockResolvedValueOnce({ stdout: `go version ${version}`, stderr: '' })
    expect((await probeDesktopToolchain('darwin', {})).map(failure => failure.tool)).toEqual(['go'])
  })

  it('reports an unavailable Go compiler and honors the configured executable', async () => {
    goVersion.mockRejectedValueOnce(new Error('compiler unavailable'))
    expect(await probeDesktopToolchain('darwin', { DSH_DESKTOP_GO_BINARY: '/custom/go' }))
      .toEqual([{ tool: 'go', detail: 'compiler unavailable' }])
    expect(goVersion).toHaveBeenCalledWith('/custom/go', expect.objectContaining({
      env: expect.objectContaining({ GOTOOLCHAIN: 'local' }),
    }))
  })

  it('writes nothing into the working directory while probing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-probe-cwd-'))
    directories.push(directory)
    await writeFile(join(directory, 'sentinel'), '')
    await probeDesktopToolchain('darwin', {})
    expect(await import('node:fs/promises').then(async fs => fs.readdir(directory))).toEqual(['sentinel'])
  })
})
