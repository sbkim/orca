import type { FolderWorkspacePathStatus } from '../../../shared/folder-workspace-path-status'
import { blocksFolderWorkspaceActivation } from '../../../shared/folder-workspace-path-status'
import { translate } from '@/i18n/i18n'

export function getFolderWorkspacePathStatusTitle(
  status: FolderWorkspacePathStatus | null | undefined
): string | null {
  if (!status || status.exists) {
    return null
  }
  switch (status.reason) {
    case 'missing':
      return translate('auto.lib.folder.workspace.path.status.folderNotFound', 'Folder not found')
    case 'not-directory':
      return translate(
        'auto.lib.folder.workspace.path.status.pathNotFolder',
        'Path is not a folder'
      )
    case 'ambiguous-connection':
      return translate(
        'auto.lib.folder.workspace.path.status.cannotDetermineConnection',
        'Cannot determine connection'
      )
    case 'unavailable':
    case undefined:
      return translate(
        'auto.lib.folder.workspace.path.status.cannotCheckFolder',
        'Cannot check folder'
      )
  }
}

export function getFolderWorkspacePathStatusDescription(
  status: FolderWorkspacePathStatus | null | undefined
): string | null {
  if (!status || status.exists) {
    return null
  }
  switch (status.reason) {
    case 'missing':
      return translate(
        'auto.lib.folder.workspace.path.status.missingDescription',
        'Orca cannot find {{value0}}. Remove and re-import this folder workspace.',
        { value0: status.path }
      )
    case 'not-directory':
      return translate(
        'auto.lib.folder.workspace.path.status.notDirectoryDescription',
        '{{value0}} exists, but it is not a folder.',
        { value0: status.path }
      )
    case 'ambiguous-connection':
      return translate(
        'auto.lib.folder.workspace.path.status.ambiguousConnectionDescription',
        'Orca cannot tell which SSH connection owns this folder scope.'
      )
    case 'unavailable':
    case undefined:
      return translate(
        'auto.lib.folder.workspace.path.status.unavailableDescription',
        'Orca cannot verify this folder right now. Check the runtime or SSH connection and try again.'
      )
  }
}

export function formatFolderWorkspaceCreateError(error: unknown): {
  title: string
  description: string
} {
  const message = error instanceof Error ? error.message : String(error)
  const path = message.includes(':') ? message.slice(message.indexOf(':') + 1) : ''
  if (message.startsWith('folder_workspace_path_missing:')) {
    return {
      title: translate('auto.lib.folder.workspace.path.status.folderNotFound', 'Folder not found'),
      description: translate(
        'auto.lib.folder.workspace.path.status.createMissingDescription',
        'Orca cannot find {{value0}}. Remove and re-import the folder.',
        { value0: path }
      )
    }
  }
  if (message.startsWith('folder_workspace_path_not_directory:')) {
    return {
      title: translate(
        'auto.lib.folder.workspace.path.status.pathNotFolder',
        'Path is not a folder'
      ),
      description: translate(
        'auto.lib.folder.workspace.path.status.notDirectoryDescription',
        '{{value0}} exists, but it is not a folder.',
        { value0: path }
      )
    }
  }
  if (message.startsWith('folder_workspace_connection_ambiguous:')) {
    return {
      title: translate(
        'auto.lib.folder.workspace.path.status.cannotDetermineConnection',
        'Cannot determine connection'
      ),
      description: translate(
        'auto.lib.folder.workspace.path.status.ambiguousConnectionDescription',
        'Orca cannot tell which SSH connection owns this folder scope.'
      )
    }
  }
  if (message.startsWith('folder_workspace_path_unavailable:')) {
    return {
      title: translate(
        'auto.lib.folder.workspace.path.status.cannotCheckFolder',
        'Cannot check folder'
      ),
      description: translate(
        'auto.lib.folder.workspace.path.status.unavailableDescription',
        'Orca cannot verify this folder right now. Check the runtime or SSH connection and try again.'
      )
    }
  }
  return {
    title: translate(
      'auto.lib.folder.workspace.path.status.createFailed',
      'Failed to create folder workspace'
    ),
    description: message
  }
}

export function folderWorkspaceActivationBlocked(
  status: FolderWorkspacePathStatus | null | undefined
): boolean {
  return blocksFolderWorkspaceActivation(status)
}
