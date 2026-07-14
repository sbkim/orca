import CryptoKit
import Security
import UserNotifications

private let keychainAccessGroup = "3F566TG5CC.com.omninetworks.orca.mobile.push"
// Why: Expo SecureStore 55 appends this alias for non-authenticated records;
// the extension must query the physical service name rather than the JS option.
private let keychainService = "orca.notification-service.keys:no-auth"
private let keyPrefix = "orca.ios-push-key."
private let authenticatedData = Data("orca-ios-push-v1".utf8)
private let envelopeVersion: UInt8 = 1
private let nonceBytes = 12
private let tagBytes = 16

private struct NotificationKeyRecord: Decodable {
  let keyB64: String
  let hostId: String
}

private struct PushPayload: Decodable {
  let title: String
  let body: String
  let worktreeId: String?
  let source: String?
}

final class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttemptContent: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    bestAttemptContent = request.content.mutableCopy() as? UNMutableNotificationContent

    guard let content = bestAttemptContent,
          let payloadB64 = content.userInfo["payload"] as? String,
          let pushKeyId = content.userInfo["pushKeyId"] as? String,
          let keyRecord = loadKeyRecord(pushKeyId),
          let payload = decryptPayload(payloadB64, keyRecord: keyRecord) else {
      deliverBestAttempt()
      return
    }

    content.title = payload.title
    content.body = payload.body
    var data = content.userInfo
    data.removeValue(forKey: "payload")
    data.removeValue(forKey: "pushKeyId")
    data["hostId"] = keyRecord.hostId
    data["notificationId"] = content.userInfo["notificationId"]
    if let worktreeId = payload.worktreeId {
      data["worktreeId"] = worktreeId
    }
    if let source = payload.source {
      data["source"] = source
    }
    content.userInfo = data
    contentHandler(content)
  }

  override func serviceExtensionTimeWillExpire() {
    // Why: APNs requires completion before the extension deadline; the generic
    // encrypted placeholder is safer than dropping the notification entirely.
    deliverBestAttempt()
  }

  private func deliverBestAttempt() {
    guard let contentHandler, let bestAttemptContent else { return }
    contentHandler(bestAttemptContent)
  }

  private func loadKeyRecord(_ keyId: String) -> NotificationKeyRecord? {
    let key = keyPrefix + keyId
    let account = Data(key.utf8)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrGeneric as String: account,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: keychainAccessGroup,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
          let data = item as? Data else {
      return nil
    }
    return try? JSONDecoder().decode(NotificationKeyRecord.self, from: data)
  }

  private func decryptPayload(
    _ payloadB64: String,
    keyRecord: NotificationKeyRecord
  ) -> PushPayload? {
    guard let bundle = Data(base64Encoded: payloadB64),
          bundle.count >= 1 + nonceBytes + tagBytes,
          bundle.first == envelopeVersion,
          let keyData = Data(base64Encoded: keyRecord.keyB64),
          keyData.count == 32 else {
      return nil
    }
    let nonceStart = bundle.index(after: bundle.startIndex)
    let ciphertextStart = bundle.index(nonceStart, offsetBy: nonceBytes)
    let tagStart = bundle.index(bundle.endIndex, offsetBy: -tagBytes)
    do {
      let nonce = try AES.GCM.Nonce(data: bundle[nonceStart..<ciphertextStart])
      let sealedBox = try AES.GCM.SealedBox(
        nonce: nonce,
        ciphertext: bundle[ciphertextStart..<tagStart],
        tag: bundle[tagStart..<bundle.endIndex]
      )
      let plaintext = try AES.GCM.open(
        sealedBox,
        using: SymmetricKey(data: keyData),
        authenticating: authenticatedData
      )
      return try JSONDecoder().decode(PushPayload.self, from: plaintext)
    } catch {
      return nil
    }
  }
}
