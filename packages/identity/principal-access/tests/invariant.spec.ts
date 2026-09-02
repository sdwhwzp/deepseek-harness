import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as PrincipalAccessInvariant from '@deepseek-ai/dsh-principal-access/invariant'
import { describe, expect, it } from 'vitest'

describe('principal-access invariant companion', () => {
  it('registers package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(PrincipalAccessInvariant).await()).resolves.toBeDefined()
  })
})
