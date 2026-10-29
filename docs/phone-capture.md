# Phone capture (Scan)

Take a photo with your phone and bring it straight into MirrorCat. This is
step 2 of "scan an object" (decision 028): a photo taken from beside the
projector is the input for registration (projected markers), background
removal, and the mask that already lines up (step 1, decision 024).

## The flow

1. **Scan** in the top bar opens a dialog with a QR code.
2. The phone's camera reads it and opens a page served by MirrorCat on the
   home network. The page says where to stand (beside the projector, 1×
   lens, whole object in frame) and has one button: Take photo.
3. The photo arrives in the media library ("Scan Oct 28, 2026, 7:19 PM").
   The dialog shows it with **Put on <surface>**, **Take another** and
   **Done**.

The dialog shows live status: waiting for your phone, phone connected,
receiving the photo, or why a photo was refused.

## How it's built

| Piece | Where |
| --- | --- |
| Address picker | `main/capture/lanAddress.ts` -- the IPv4 address on a real Wi-Fi/Ethernet interface, private ranges first; skips VPN (utun, tailscale, wg), containers, VMs, Apple peer links and link-local |
| Server | `main/capture/captureServer.ts` -- Node `http`, one per scan |
| Phone page | `main/capture/phonePage.ts` -- self-contained HTML, nonce CSP |
| IPC | `main/ipc/captureHandlers.ts` -- `capture:start` / `capture:stop` (control window only), `capture:event` to the editor |
| QR code | `qrcode` (MIT), rendered as SVG in main, shown as a data: image |
| Dialog | `renderer/components/ScanDialog.tsx`, `styles/scan.css` |

**Why a file input, not a live camera view.** `getUserMedia` needs a
secure context, and a page on `http://192.168.x.x` isn't one, so a live
viewfinder would need HTTPS with a self-signed certificate (scary browser
warnings) or a cloud relay (a backend). `<input type="file"
accept="image/*" capture="environment">` opens the phone's own camera over
plain http.

**Why the phone re-encodes.** The page draws the photo to a canvas and
sends a JPEG of at most 4096 px. That converts iPhone HEIC (which the
library rejects), applies the photo's rotation, and keeps uploads to a few
MB.

## Security

The server is reachable by anything on the home network while it runs, so
it's built to give nothing away:

- It runs only while the Scan dialog is open, and for at most 10 minutes.
  It listens on one LAN address (never 0.0.0.0) and a random port.
- Every route needs a 128-bit one-time token, compared in constant time.
  A wrong token gets exactly the same "link isn't active" page as an
  expired one.
- The Host header must match the address and port, which blocks
  DNS-rebinding pages in a browser on this computer.
- Only one route accepts data. It takes image bytes only, at most 25 MB
  each and 10 per link, and they go through the library's byte sniffing
  like any other import. Nothing is ever read from disk by request.
- Responses are `no-store`, `nosniff` and `no-referrer`. The phone page
  runs under `default-src 'none'` with a per-response nonce.

## Troubleshooting

- **Phone can't open the link.**
  - The phone and computer must be on the same network. Guest Wi-Fi and
    "client isolation" block it, and so do VPNs on either device.
  - The first time, macOS asks whether MirrorCat may accept incoming
    connections. It needs Allow.
- **"Isn't on a Wi-Fi or wired network."** No usable interface was found.
  Connect the computer to the network.
- **Photo refused.** The dialog shows the library's reason, for example an
  unsupported format.

Development: `MIRRORCAT_CAPTURE_HOST=127.0.0.1` forces the address
(unpackaged builds only). The e2e test uses it because CI machines may
have no Wi-Fi.

## Next

- Projected ArUco markers while scanning, so the photo maps onto projector
  pixels automatically.
- Tap-to-select (SAM 2) on the photo, writing the selection into the
  surface's mask.
- Later: Gray-code structured light for a per-pixel fit.
