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

## Lining the photo up with the projector

When you're live, the projector shows a **scan pattern** while the dialog
waits for a photo (`shared/scanPattern.ts`, drawn by
`components/ScanPattern.tsx`): soft gray light to see the object by, a
bright border, and an ArUco marker (ARUCO_MIP_36h12, ids 0–3) inset in
each corner. The phone page then asks you to fit the whole glowing frame
in the photo.

When the photo arrives:

1. **Find the frame.** Main decodes the photo (`nativeImage`), scans it at
   ≤1600 px with js-aruco2 (MIT), and pairs each found marker's four
   corners with where it was drawn. `fitHomography` (`shared/homography.ts`,
   a normalized least-squares fit) gives frame → photo from all 16 points,
   and the frame's corners come out of it (`main/capture/frameDetect.ts`).
   Two markers are enough. With fewer than four found, the result is
   flagged "estimated" and the missing corners are highlighted. The frame
   size is the projector window's, since that's what the pattern filled.
2. **Check it.** The dialog shows the photo with the frame outlined
   (`FrameCornersEditor`). Drag a corner, or use the arrow keys (Shift for
   bigger steps), to fix it. If nothing was found you start from a guess.
3. **Project onto the wall.** Main straightens the frame's part of the
   photo into an image the projector's shape (`main/capture/rectify.ts`,
   `capture:rectify`: per output pixel, the unit-square → frame-in-photo
   homography gives the photo point, sampled bilinearly) and saves it as
   "<photo> (fit to projector)". A new "Scan" surface fills the frame
   exactly (corners 0..1) and shows it, so every pixel lands on the
   projector pixel that lit it. The objects light up with their own
   image, which is the accuracy check, and you can outline an object in
   mask mode right over its photo. The surface never reaches past the
   projector's area: nothing outside the frame can be lit anyway, and its
   corners stay on the stage.

   *First version (replaced):* a surface the size of the whole photo,
   corners far outside the frame. It lit the same pixels, but its outline
   and corners ran off the stage (decision 030).

Not live: no pattern, and the photo can go on a surface as-is.

## Shapes → surfaces

After lining up, **Continue** fits the photo to the projector and finds
the shapes in it (decision 031). **Pick the shapes** shows them outlined
and numbered. Click one, or its row, to pick it. Each picked shape goes to
a **New surface** or onto an existing one (**Move Vase here**).

- **Make N surfaces** puts the corners in place.
  - Four-sided shapes (frames, doors, box faces) get exactly their corners.
  - Anything else gets a rectangle around it plus an exact mask.
- Then drop your own content on each surface.
- **Project the whole photo** is still there for using the photo itself.

The built-in finder handles flat, solid, reasonably high-contrast
shapes. Organic or low-contrast objects (plants, a white box on a white
wall) are what SAM 2 is for (next). Until then, draw those with the mask
tools.

## How it's built

| Piece | Where |
| --- | --- |
| Address picker | `main/capture/lanAddress.ts` -- the IPv4 address on a real Wi-Fi/Ethernet interface, private ranges first; skips VPN (utun, tailscale, wg), containers, VMs, Apple peer links and link-local |
| Server | `main/capture/captureServer.ts` -- Node `http`, one per scan |
| Phone page | `main/capture/phonePage.ts` -- self-contained HTML, nonce CSP |
| IPC | `main/ipc/captureHandlers.ts` -- `capture:start` / `capture:stop` (control window only), `capture:event` to the editor |
| QR code | `qrcode` (MIT), rendered as SVG in main, shown as a data: image |
| Dialog | `renderer/components/ScanDialog.tsx`, `FrameCornersEditor.tsx`, `styles/scan.css` |
| Shape finding | `shared/shapes.ts` (geometry), `main/capture/shapeDetect.ts` (regions, quads, masks), `components/ShapePicker.tsx`; IPC `capture:find-shapes`, `capture:shape-mask` |
| Scan pattern + frame detection | `shared/scanPattern.ts`, `shared/homography.ts`, `main/capture/frameDetect.ts`, `components/ScanPattern.tsx` (projector) |

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

- SAM 2 as a second shape finder, for organic and low-contrast shapes:
  its masks feed the same picker. Also tap-to-add a shape the finder
  missed, and merge shapes it split.
- Generative content per shape: the photo crop and the shape's mask as
  the prompt's canvas.
- Run frame and shape detection in a worker (main thread today).
- Later: Gray-code structured light for a per-pixel fit.
