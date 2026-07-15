export function autoUpdatesDisabledForBuild(): boolean {
  if (typeof ORCA_DISABLE_AUTO_UPDATE !== 'undefined') {
    return ORCA_DISABLE_AUTO_UPDATE
  }

  // Why: Vitest does not run electron-vite's compile-time substitution, so
  // tests need a controlled fallback without adding a runtime env escape hatch.
  return (globalThis as { ORCA_DISABLE_AUTO_UPDATE?: boolean }).ORCA_DISABLE_AUTO_UPDATE ?? false
}
