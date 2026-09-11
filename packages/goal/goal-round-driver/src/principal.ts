import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

/** Recover a tool caller from committed turn state, including a mid-turn plugin mount. */
export const goalRoundOwnerProjection: ProjectionDefinition<'goalRoundOwner'> = {
  key: 'goalRoundOwner',
  stateVersion: 1,
  stateSchema: z.object({
    source: z.string(),
    id: z.string(),
    username: z.string(),
    role: z.enum(['admin', 'user']),
  }).nullable(),
  init: () => null,
  apply: (state, event) => {
    switch (event.type) {
      case 'turn/start': return event.data.principal ?? null
      case 'turn/end': return null
      default: return state
    }
  },
}
