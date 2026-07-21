import { rawClient } from '@girae/common/queue'
import type { ButtonSpec } from '@girae/common/dbos/messaging'
import { maybeStep } from '@girae/common/dbos/maybeStep'

const CLAIM_TTL_SECONDS = 60 * 60

export interface GirarActiveStep {
  content: string
  photoUrl?: string
  buttons: ButtonSpec[][]
}

export interface GirarActiveState {
  workflowID: string
  kind: 'interactive' | 'batch'
  step?: GirarActiveStep
}

const claimKey = (authorId: string) => `girar:active:${authorId}`

// Wrapped as DBOS steps so a workflow replay reuses the recorded result
export const claimGirar = maybeStep('claimGirar', async (authorId: string, initial: GirarActiveState): Promise<boolean> => {
  const result = await rawClient.set(claimKey(authorId), JSON.stringify(initial), { NX: true, EX: CLAIM_TTL_SECONDS })
  return result === 'OK'
})

export const getGirarActive = maybeStep('getGirarActive', async (authorId: string): Promise<GirarActiveState | null> => {
  const raw = await rawClient.get(claimKey(authorId))
  return raw ? (JSON.parse(raw) as GirarActiveState) : null
})

export const updateGirarStep = maybeStep('updateGirarStep', async (authorId: string, workflowID: string, step: GirarActiveStep): Promise<void> => {
  const state: GirarActiveState = { workflowID, kind: 'interactive', step }
  await rawClient.set(claimKey(authorId), JSON.stringify(state), { EX: CLAIM_TTL_SECONDS })
})

export const releaseGirar = maybeStep('releaseGirar', async (authorId: string): Promise<void> => {
  await rawClient.del(claimKey(authorId))
})
