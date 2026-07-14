/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'notification-service',
  name: 'OrcaNotificationService',
  displayName: 'Orca Notification Service',
  bundleIdentifier: '.notification-service',
  deploymentTarget: '15.1',
  entitlements: {
    // Why: only the app and its extension may read per-desktop push keys.
    'keychain-access-groups': ['3F566TG5CC.com.omninetworks.orca.mobile.push']
  }
}
