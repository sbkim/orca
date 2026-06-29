// Why: the pure filter/group/query core now lives in /shared so the mobile
// package can reuse it (Metro can't import renderer). Re-export for renderer
// import parity — desktop behavior is unchanged.
export type {
  AiVaultSessionProject,
  AiVaultSessionFilterState,
  AiVaultSessionGroup
} from '../../../../shared/ai-vault-session-filters'
export {
  AI_VAULT_SESSION_FILTER_QUERY_MAX_BYTES,
  agentLabel,
  filterAiVaultSessions,
  folderLabel,
  groupAiVaultSessions,
  isAiVaultSessionFilterQueryTooLarge,
  parseVaultQuery
} from '../../../../shared/ai-vault-session-filters'
