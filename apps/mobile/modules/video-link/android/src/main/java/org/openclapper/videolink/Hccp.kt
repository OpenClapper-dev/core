package org.openclapper.videolink

import android.net.Network
import java.io.DataInputStream
import java.io.IOException
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException

/**
 * Hollyland's control protocol (HCCP) as far as the picture needs it (docs/features/live-picture.md):
 * the transmitter answers RTSP only while a client is logged in on TCP 60007, has sent the query burst
 * that follows the login, and keeps the session alive every second.
 */
internal class Hccp(
  private val network: Network?,
  private val host: String,
  private val ssid: String,
  private val appId: ByteArray,
) {
  private var socket: Socket? = null
  private var thread: Thread? = null

  /** Set when the control session ends on its own; the picture stops soon after, so the caller restarts. */
  @Volatile var lost: String? = null
    private set

  /** Logs in and sends the query burst; throws with the transmitter's reason when it refuses. */
  fun open() {
    val s = Socket()
    socket = s
    network?.bindSocket(s)
    s.connect(InetSocketAddress(host, PORT), 3000)
    s.soTimeout = 3000
    s.tcpNoDelay = true
    val out = s.getOutputStream()
    val input = DataInputStream(s.getInputStream())
    out.write(login())
    out.flush()
    while (true) {
      val header = ByteArray(HEADER)
      input.readFully(header)
      val len = le32(header, 2)
      if (len < 0 || len > 1 shl 20) throw IOException("Transmitter sent a malformed reply")
      val body = ByteArray(len)
      input.readFully(body)
      if (header[1].toInt() and 0xff != OP_LOGIN) continue
      val status = if (body.isEmpty()) -1 else body[0].toInt() and 0xff
      if (status == 2) throw IOException("The transmitter has too many viewers")
      if (status != 0) throw IOException("The transmitter refused the login ($status)")
      break
    }
    for (op in BURST) out.write(frame(op, if (op == OP_TIME) le64(System.currentTimeMillis()) else EMPTY))
    out.flush()
    thread = Thread({ keepAlive(s, out) }, "hccp").apply { isDaemon = true; start() }
  }

  /** Alternates the two keep-alives every second and drains the replies, which the picture does not need. */
  private fun keepAlive(s: Socket, out: OutputStream) {
    val input = s.getInputStream()
    val sink = ByteArray(4096)
    var alt = false
    var next = System.currentTimeMillis() + 1000
    try {
      s.soTimeout = 250
      while (!s.isClosed) {
        try {
          if (input.read(sink) < 0) { lost = "The transmitter closed the control session"; return }
        } catch (_: SocketTimeoutException) {
        }
        val now = System.currentTimeMillis()
        if (now >= next) {
          alt = !alt
          out.write(if (alt) frame(OP_PING) else frame(OP_DEVICE, fixed(ssid.toByteArray(Charsets.US_ASCII), 12)))
          out.flush()
          next = now + 1000
        }
      }
    } catch (e: IOException) {
      if (!s.isClosed) lost = "Control session lost: ${e.message}"
    }
  }

  fun close() {
    try { socket?.close() } catch (_: IOException) {}
    socket = null
  }

  private fun login(): ByteArray {
    val ascii = Charsets.US_ASCII
    return frame(OP_LOGIN, fixed(ssid.toByteArray(ascii), 12) + byteArrayOf(0) + fixed(appId, 16) + fixed(host.toByteArray(ascii), 32))
  }

  companion object {
    const val PORT = 60007
    private const val HEADER = 19
    private const val OP_LOGIN = 60
    private const val OP_PING = 63
    private const val OP_DEVICE = 53
    private const val OP_TIME = 64
    /** HollyView's queries right after the login, in its order; without them RTSP stays silent. */
    private val BURST = intArrayOf(79, OP_TIME, 82, 95, 71, 55, 61, 80, 91, 89)
    private val EMPTY = ByteArray(0)

    /** Version 1, opcode, payload length (LE32), 1, 8 zero bytes, sequence 0 (LE32), payload. */
    fun frame(op: Int, payload: ByteArray = EMPTY): ByteArray {
      val f = ByteArray(HEADER + payload.size)
      f[0] = 1
      f[1] = op.toByte()
      for (i in 0 until 4) f[2 + i] = (payload.size ushr (8 * i)).toByte()
      f[6] = 1
      payload.copyInto(f, HEADER)
      return f
    }

    private fun fixed(b: ByteArray, n: Int): ByteArray = b.copyOf(n)
    private fun le32(b: ByteArray, at: Int): Int =
      (b[at].toInt() and 0xff) or ((b[at + 1].toInt() and 0xff) shl 8) or ((b[at + 2].toInt() and 0xff) shl 16) or ((b[at + 3].toInt() and 0xff) shl 24)
    private fun le64(v: Long): ByteArray = ByteArray(8) { (v ushr (8 * it)).toByte() }
  }
}
