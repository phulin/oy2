import Capacitor

@objc(APNSEnvironmentPlugin)
public class APNSEnvironmentPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "APNSEnvironmentPlugin"
    public let jsName = "APNSEnvironment"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getEnvironment", returnType: CAPPluginReturnPromise)
    ]

    @objc func getEnvironment(_ call: CAPPluginCall) {
        call.resolve(["environment": Self.detect()])
    }

    static func detect() -> String {
        guard let provisionURL = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: provisionURL),
              let raw = String(data: data, encoding: .ascii) else {
            // App Store builds strip embedded.mobileprovision → always production
            return "production"
        }

        guard let keyRange = raw.range(of: "<key>aps-environment</key>") else {
            return "production"
        }

        let after = raw[keyRange.upperBound...]
        guard let open = after.range(of: "<string>"),
              let close = after.range(of: "</string>") else {
            return "production"
        }

        let value = raw[open.upperBound..<close.lowerBound]
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return value == "production" ? "production" : "sandbox"
    }
}
