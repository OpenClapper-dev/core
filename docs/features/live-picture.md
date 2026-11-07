# Live picture

The picture of a Hollyland Mars 400S Pro wireless video transmitter on the phone, with HollyView's latency as the target (issue [#302](https://github.com/OpenClapper-dev/core/issues/302), part of epic [#206](https://github.com/OpenClapper-dev/core/issues/206)). Later it sits next to the lights and sequences on one screen. Setup → **Live picture** shows it.

**Status:** prototype, Android only, one transmitter at its default address. Tested on the owner's phone (2026-11-07): 1920 × 1080 at 25 fps, about 2.5 Mbit/s, 15–21 ms from a frame's last packet to display, no dropped frames. The picture is back within 3 s after reopening the screen or returning from the background, and the server stays reachable over mobile data meanwhile. The owner judged the latency fine by eye; a glass-to-glass measurement against HollyView is still open.

## How the transmitter is reached

The transmitter is a Wi-Fi access point (`HLD_…`, no internet) at `192.168.218.10`. The phone joins it in Android's settings and keeps mobile data for the server. Every socket of the picture is bound to the Wi-Fi network (`Network.bindSocket`), so Android does not route it through mobile data, and the rest of the app keeps using the internet.

1. **Control (HCCP, TCP 60007)**: Hollyland's own protocol. Each frame has a 19-byte header (version `01`, opcode, payload length LE32, `01`, 8 zero bytes, sequence LE32 = 0) and then the payload.
   - **Login** (opcode 60): Wi-Fi name (12 bytes), type `00`, an app id (16 bytes; the phone's Android ID as 8 bytes, as HollyView does), the transmitter's IP as text (32 bytes). Reply byte 0: 0 ok, 1 failed, 2 too many viewers.
   - **Query burst**: right after the login, opcodes 79, 64 (time, ms LE64), 82, 95, 71, 55, 61, 80, 91, 89. **Without it the RTSP server stays silent.**
   - **Keep-alive** every second, alternating opcode 63 (empty) and 53 (Wi-Fi name).
2. **Picture (RTSP, `rtsp://192.168.218.10:5554`)**: plain RTSP. H.264 (payload type 96, packetization-mode 1, SPS/PPS in-band only: no `sprop-parameter-sets`), RTP over **UDP**. RTP over TCP (interleaved) is accepted but the transmitter resets it after about a second. OPTIONS every 30 s and an RTCP receiver report every 5 s keep it going.

The Wi-Fi name comes from Android, which shows it only with the location permission (the app has it for GPS; the screen asks again).

## On the phone (`apps/mobile/modules/video-link`)

A local Expo module in Kotlin, because the low latency needs a pipeline without buffers. Media3's RTSP player also rejects an SDP without `sprop-parameter-sets`. No dependency.

- `Hccp.kt`: login, burst, keep-alive.
- `Rtsp.kt`: OPTIONS, DESCRIBE (SDP parse), SETUP over UDP, PLAY, keep-alive, TEARDOWN.
- `H264Depacketizer.kt`: RTP to Annex-B frames (single NAL, STAP-A, FU-A). The transmitter packs SPS, PPS and the IDR slice into one RTP NAL unit joined by start codes, so each NAL unit is split at start codes inside it to find the parameter sets and key frames. A lost packet drops only its fragmented NAL; the decoder conceals the rest instead of freezing until the next key frame.
- `Decoder.kt`: the hardware decoder (`MediaCodec`, low-latency mode on Android 11+). It starts as soon as SPS and PPS are known, not on an IDR frame: a low-latency stream may refresh gradually and never send one. A frame is rendered as soon as it is decoded; a full decoder drops the frame instead of queueing it.
- `LinkSession.kt`: one session on its own thread. It retries after 1, 2, 5 s and gives up on a session after 3 s without a packet.
- `VideoLinkView.kt`: a `TextureView` with the picture letterboxed; it runs while `active`, mounted and the surface exists. It reports its state once a second (`onStatus`): fps, Mbit/s, decode time (last packet to display), packets lost, frames dropped. Until the first frame it also reports what arrived (RTP packets, NAL units by type, the decoder state), and the screen logs it every 5 s to the debug log.

`src/screens/LivePicture.tsx` shows it with these numbers and keeps the screen on.

## Measuring latency

Film a running clock with the camera that feeds the transmitter, then photograph the clock and the phone together; the difference is glass-to-glass. Do it once with HollyView and once here. The decode figure on screen is only the phone's share.
