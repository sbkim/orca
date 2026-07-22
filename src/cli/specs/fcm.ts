import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const LOCAL_HOST_NOTE =
  'Run this command on the Orca host. Remote environment and pairing-code selection are ignored for credential safety.'

export const FCM_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['fcm', 'set'],
    summary: 'Configure FCM push with a Google service-account JSON file',
    usage: 'orca fcm set --file <path> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'file'],
    notes: [
      LOCAL_HOST_NOTE,
      'The credential is protected through Electron safeStorage by the running Orca host before persistence.'
    ],
    examples: ['orca fcm set --file ./firebase-service-account.json']
  },
  {
    path: ['fcm', 'status'],
    summary: 'Show whether FCM push is configured on this Orca host',
    usage: 'orca fcm status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [LOCAL_HOST_NOTE]
  },
  {
    path: ['fcm', 'clear'],
    destructive: true,
    summary: 'Remove the FCM service-account credential from this Orca host',
    usage: 'orca fcm clear [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [LOCAL_HOST_NOTE]
  }
]
