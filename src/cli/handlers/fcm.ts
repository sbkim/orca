import { open, type FileHandle } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  FCM_SERVICE_ACCOUNT_JSON_MAX_CHARACTERS,
  parseFcmServiceAccountJson
} from '../../shared/fcm-service-account'
import type {
  FcmServiceAccountClearResult,
  FcmServiceAccountSetResult,
  FcmServiceAccountStatus
} from '../../shared/types'
import type { CommandHandler } from '../dispatch'
import { getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'

async function readServiceAccountFile(path: string): Promise<string> {
  let handle: FileHandle | undefined
  try {
    handle = await open(path, 'r')
    const file = await handle.stat()
    if (!file.isFile()) {
      throw new RuntimeClientError(
        'invalid_argument',
        `Service-account path is not a file: ${path}`
      )
    }
    if (file.size > FCM_SERVICE_ACCOUNT_JSON_MAX_CHARACTERS) {
      throw new RuntimeClientError('invalid_argument', 'Service-account JSON is too large.')
    }
    // Why: read one byte beyond the limit so a file that grows after stat is
    // still rejected without loading an unbounded credential into memory.
    const bytes = Buffer.alloc(FCM_SERVICE_ACCOUNT_JSON_MAX_CHARACTERS + 1)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    if (bytesRead > FCM_SERVICE_ACCOUNT_JSON_MAX_CHARACTERS) {
      throw new RuntimeClientError('invalid_argument', 'Service-account JSON is too large.')
    }
    return bytes.subarray(0, bytesRead).toString('utf8')
  } catch (error) {
    if (error instanceof RuntimeClientError) {
      throw error
    }
    throw new RuntimeClientError(
      'invalid_argument',
      `Could not read service-account JSON file: ${path}`
    )
  } finally {
    await handle?.close()
  }
}

function formatStatus(status: FcmServiceAccountStatus): string {
  if (!status.configured) {
    return 'FCM push is not configured.'
  }
  return status.projectId
    ? `FCM push is configured for project ${JSON.stringify(status.projectId)}.`
    : 'FCM push is configured.'
}

export const FCM_HANDLERS: Record<string, CommandHandler> = {
  'fcm set': async ({ client, cwd, flags, json }) => {
    const filePath = resolve(cwd, getRequiredStringFlag(flags, 'file'))
    const serviceAccountJson = await readServiceAccountFile(filePath)
    const parsed = parseFcmServiceAccountJson(serviceAccountJson)
    if (!parsed.ok) {
      throw new RuntimeClientError('invalid_argument', parsed.error)
    }
    const response = await client.call<FcmServiceAccountSetResult>('fcm.setServiceAccount', {
      serviceAccountJson
    })
    if (!response.result.ok) {
      throw new RuntimeClientError('invalid_argument', response.result.error)
    }
    const successfulResponse = { ...response, result: response.result }
    printResult(
      successfulResponse,
      json,
      (result) => `Configured FCM push for project ${JSON.stringify(result.projectId)}.`
    )
  },
  'fcm status': async ({ client, json }) => {
    const response = await client.call<FcmServiceAccountStatus>('fcm.getServiceAccountStatus')
    printResult(response, json, formatStatus)
  },
  'fcm clear': async ({ client, json }) => {
    const response = await client.call<FcmServiceAccountClearResult>('fcm.clearServiceAccount')
    printResult(response, json, () => 'Cleared the FCM service-account credential.')
  }
}
