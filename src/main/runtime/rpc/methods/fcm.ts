import { z } from 'zod'
import { FCM_SERVICE_ACCOUNT_JSON_MAX_CHARACTERS } from '../../../../shared/fcm-service-account'
import { defineMethod, type RpcContext, type RpcMethod } from '../core'

const SetServiceAccountParams = z.object({
  serviceAccountJson: z
    .string()
    .min(1, 'Service-account JSON is empty.')
    .max(FCM_SERVICE_ACCOUNT_JSON_MAX_CHARACTERS, 'Service-account JSON is too large.')
})

class FcmCredentialAccessError extends Error {
  readonly code = 'forbidden'

  constructor() {
    super('FCM credential management is available only from a local Orca CLI on the host.')
  }
}

function assertLocalCredentialAccess(ctx: RpcContext): void {
  // Why: paired WebSocket clients are bearer-authenticated but must not gain a
  // credential-write surface; operators configure the host through its socket.
  if (ctx.clientKind !== undefined) {
    throw new FcmCredentialAccessError()
  }
}

export const FCM_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'fcm.setServiceAccount',
    params: SetServiceAccountParams,
    handler: (params, ctx) => {
      assertLocalCredentialAccess(ctx)
      return ctx.runtime.setFcmServiceAccount(params.serviceAccountJson)
    }
  }),
  defineMethod({
    name: 'fcm.getServiceAccountStatus',
    params: null,
    handler: (_params, ctx) => {
      assertLocalCredentialAccess(ctx)
      return ctx.runtime.getFcmServiceAccountStatus()
    }
  }),
  defineMethod({
    name: 'fcm.clearServiceAccount',
    params: null,
    handler: (_params, ctx) => {
      assertLocalCredentialAccess(ctx)
      return ctx.runtime.clearFcmServiceAccount()
    }
  })
]
