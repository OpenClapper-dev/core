package org.openclapper.videolink

import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.provider.Settings
import android.view.Surface
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import kotlin.random.Random

/**
 * One viewing session on its own thread, retrying until stopped: find the Wi-Fi, log in (HCCP), start
 * RTSP, then receive RTP and decode. Every socket is bound to the Wi-Fi network, because the
 * transmitter's network has no internet and Android would otherwise route through mobile data.
 */
internal class LinkSession(
  private val context: Context,
  private val host: String,
  private val surface: Surface,
  private val status: (Map<String, Any>) -> Unit,
  private val onSize: (Int, Int) -> Unit,
) {
  @Volatile private var running = true
  @Volatile private var closer: (() -> Unit)? = null
  private val thread = Thread({ loop() }, "video-link").apply { isDaemon = true }

  fun start() = thread.start()

  fun stop() {
    running = false
    closer?.let { c -> Thread({ c() }, "video-link-stop").start() }
    thread.interrupt()
  }

  private fun loop() {
    var attempt = 0
    while (running) {
      try {
        runOnce { attempt = 0 }
      } catch (e: Exception) {
        if (!running) break
        status(mapOf("state" to "error", "message" to (e.message ?: e.javaClass.simpleName)))
      }
      if (!running) break
      try { Thread.sleep(BACKOFF_MS[minOf(attempt++, BACKOFF_MS.size - 1)]) } catch (_: InterruptedException) { break }
    }
    status(mapOf("state" to "idle"))
  }

  private fun runOnce(onPlaying: () -> Unit) {
    status(mapOf("state" to "searching"))
    val network = wifi() ?: throw IOException("The phone is not on a Wi-Fi network")
    val ssid = ssid()
    status(mapOf("state" to "connecting", "ssid" to ssid))

    val hccp = Hccp(network, host, ssid, appId())
    var rtsp: Rtsp? = null
    var rtp: DatagramSocket? = null
    var rtcp: DatagramSocket? = null
    val stats = Stats()
    val decoder = Decoder(surface, stats, onSize)
    closer = { hccp.close(); rtsp?.abort(); rtp?.close(); rtcp?.close() }
    try {
      hccp.open()
      val r = Rtsp(network, "rtsp://$host:5554")
      rtsp = r
      val track = r.describe()
      val (a, b) = portPair(network)
      rtp = a; rtcp = b
      val serverRtcp = r.setup(track, a.localPort)
      r.play()
      if (!running) return

      val depack = H264Depacketizer(track.payloadType, track.parameterSets)
      val packet = DatagramPacket(ByteArray(2048), 2048)
      val ssrc = Random.nextInt()
      var sourceSsrc = 0
      var highestSeq = 0
      var bytes = 0L
      var lastPacket = System.currentTimeMillis()
      var nextStats = lastPacket + 1000
      var nextOptions = lastPacket + 30_000
      var nextReport = lastPacket
      var playing = false
      val server = InetAddress.getByName(host)
      a.soTimeout = 200
      while (running) {
        hccp.lost?.let { throw IOException(it) }
        try {
          a.receive(packet)
          val now = System.currentTimeMillis()
          lastPacket = now
          bytes += packet.length
          val p = packet.data
          if (packet.length >= 12) {
            sourceSsrc = ((p[8].toInt() and 0xff) shl 24) or ((p[9].toInt() and 0xff) shl 16) or ((p[10].toInt() and 0xff) shl 8) or (p[11].toInt() and 0xff)
            highestSeq = ((p[2].toInt() and 0xff) shl 8) or (p[3].toInt() and 0xff)
          }
          depack.push(p, packet.length) { au -> decoder.feed(au, System.nanoTime() / 1000) }
        } catch (_: SocketTimeoutException) {
        }
        val now = System.currentTimeMillis()
        if (now - lastPacket > 3000) throw IOException(if (playing) "The picture stopped" else "No picture from the transmitter")
        if (now >= nextReport && serverRtcp > 0 && sourceSsrc != 0) {
          try { b.send(DatagramPacket(receiverReport(ssrc, sourceSsrc, highestSeq, depack.lost), 32, InetSocketAddress(server, serverRtcp))) } catch (_: IOException) {}
          nextReport = now + 5000
        }
        if (now >= nextOptions) { r.keepAlive(); nextOptions = now + 30_000 }
        if (now >= nextStats) {
          val frames = stats.frames.getAndSet(0)
          val lat = stats.latencyUs.getAndSet(0)
          if (frames > 0 && !playing) { playing = true; onPlaying() }
          status(mapOf(
            "state" to (if (playing) "playing" else "connecting"),
            "ssid" to ssid,
            "fps" to frames,
            "kbps" to (bytes * 8 / 1000).toInt(),
            "lost" to depack.lost,
            "dropped" to stats.dropped.get(),
            "decodeMs" to (if (frames > 0) lat / frames / 1000.0 else 0.0),
            "packets" to depack.packets,
            "nals" to depack.nalCounts.withIndex().filter { it.value > 0 }.joinToString(" ") { "${it.index}:${it.value}" },
            "decoder" to (if (!stats.started) "waiting for SPS/PPS" else "fed ${stats.inputs.get()} frames"),
          ))
          bytes = 0
          nextStats = now + 1000
        }
      }
    } finally {
      closer = null
      decoder.stop()
      rtsp?.close()
      hccp.close()
      rtp?.close()
      rtcp?.close()
    }
  }

  /** An even RTP port and the RTCP port above it, both bound to the Wi-Fi. */
  private fun portPair(network: Network): Pair<DatagramSocket, DatagramSocket> {
    repeat(20) {
      val a = DatagramSocket(null)
      a.reuseAddress = false
      a.bind(InetSocketAddress(0))
      val port = a.localPort
      if (port % 2 == 0 && port < 65535) {
        try {
          val b = DatagramSocket(null)
          b.bind(InetSocketAddress(port + 1))
          network.bindSocket(a)
          network.bindSocket(b)
          a.receiveBufferSize = 4 * 1024 * 1024
          return a to b
        } catch (_: IOException) {
        }
      }
      a.close()
    }
    throw IOException("No free UDP port pair")
  }

  @Suppress("DEPRECATION")
  private fun wifi(): Network? {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    return cm.allNetworks.firstOrNull { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true }
  }

  /** The Wi-Fi's name; Android hides it (returns "<unknown ssid>") without the location permission. */
  @Suppress("DEPRECATION")
  private fun ssid(): String {
    val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    val s = wm.connectionInfo?.ssid ?: return ""
    return if (s == WifiManager.UNKNOWN_SSID) "" else s.removeSurrounding("\"")
  }

  /** The login's user id: this app's Android ID as 8 bytes, as HollyView sends its own. */
  @SuppressLint("HardwareIds")
  private fun appId(): ByteArray {
    val hex = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: ""
    if (hex.length < 16) return Random.nextBytes(8)
    return ByteArray(8) { i -> hex.substring(2 * i, 2 * i + 2).toIntOrNull(16)?.toByte() ?: 0 }
  }

  companion object {
    private val BACKOFF_MS = longArrayOf(1000, 2000, 5000)

    /** RTCP receiver report (RFC 3550 §6.4.2) with one report block; some servers stop without them. */
    fun receiverReport(ssrc: Int, source: Int, highestSeq: Int, lost: Int): ByteArray {
      val b = ByteArray(32)
      fun put32(at: Int, v: Int) { for (i in 0 until 4) b[at + i] = (v ushr (24 - 8 * i)).toByte() }
      b[0] = 0x81.toByte() // V=2, one report block
      b[1] = 201.toByte()
      b[3] = 7 // length in words minus one
      put32(4, ssrc)
      put32(8, source)
      put32(12, minOf(lost, 0x7fffff)) // fraction lost 0, cumulative lost
      put32(16, highestSeq)
      return b
    }
  }
}
