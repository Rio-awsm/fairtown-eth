import { Scanner, setZXingModuleOverrides } from "@yudiel/react-qr-scanner"
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url"

// The QR decoder loads its engine from a CDN by default. Serve our own copy so scanning works on venue Wi-Fi.
setZXingModuleOverrides({
  locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
})

/** Camera QR reader. Reading a code only reports its text: nothing happens until the person confirms. */
export function QrScanner({ onCode, onError }: { onCode(text: string): void; onError(error: unknown): void }) {
  return (
    <div className="overflow-hidden rounded" aria-label="Camera">
      <Scanner
        onScan={(codes) => {
          const first = codes[0]
          if (first) onCode(first.rawValue)
        }}
        onError={onError}
        // Preferences only. The library's default demands at least 640 px height, which 480p webcams and
        // single-camera devices cannot give, so the camera would never start there.
        constraints={{ facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }}
        formats={["qr_code"]}
        sound={false}
      />
    </div>
  )
}
