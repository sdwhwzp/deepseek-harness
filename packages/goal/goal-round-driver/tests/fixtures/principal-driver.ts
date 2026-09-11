/** Exercise authenticated Remote goal creation through the shipped headless composition. */
import assert from 'node:assert/strict'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm'
import type { PrincipalAccessSubjects } from '@deepseek-ai/dsh-principal-access'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-gateway'
import type {} from '@deepseek-ai/dsh-goal'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const principal: AuthenticatedPrincipal = { source: 'fixture', id: 'owner', username: 'Owner', role: 'user' }
const overlay = process.argv[2]
assert(overlay)
const ctx = await bootProductionProfile({
  binName: 'goal-principal-test',
  profile: 'headless',
  overlayPaths: [overlay],
  prepare: (context) => {
    // The account database is the only deployment-specific boundary.
    context.reflect.provide('principalAccess', {
      resolve(caller: AuthenticatedPrincipal, subjects: PrincipalAccessSubjects) {
        assert.deepEqual(caller, principal)
        return {
          readableSessionIds: new Set(subjects.sessionIds ?? []),
          readableWorkspaceIds: new Set(subjects.workspaceIds ?? []),
        }
      },
    })
  },
})
try {
  process.stdout.write('PROFILE_READY\n')
  ctx.on('agent/error', ({ error }) => { process.stderr.write(String(error) + '\n') })
  const { agent } = await ctx.agents.create({
    sessionId: SessionId('goal-principal-session'),
    agentOptions: { provider: 'cli-mock', model: 'cli-mock' },
    meta: { cwd: process.cwd() },
  })
  process.stdout.write('AGENT_READY\n')
  const settled = Promise.withResolvers<undefined>()
  ctx.on('goal/changed', ({ agent: changed }) => {
    if (changed === agent && ctx.goals.get(agent)?.phase === 'blocked') settled.resolve(undefined)
  })
  ctx.on('agent/request', async ({ principal: owner }, next) => {
    assert.deepEqual(owner, principal)
    return next()
  })
  await ctx.typertGateway.invoke({
    namespace: 'goals', method: 'create', principal,
    args: { agentId: agent.id, request: { objective: 'Prove attributed goal execution', maxGoalRounds: 1 } },
  })
  process.stdout.write('GOAL_CREATED\n')
  await settled.promise
  await agent.whenIdle()
  assert.equal(await ctx.sessions.flush(agent.session), true, 'profile must persist the goal Session')
  process.stdout.write('GOAL_PRINCIPAL_OK\n')
} finally {
  await ctx.fiber.dispose()
}
