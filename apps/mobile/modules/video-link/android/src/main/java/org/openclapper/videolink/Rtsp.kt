package org.openclapper.videolink

import android.net.Network
import android.util.Base64
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket

/** The video track of a DESCRIBE: its control URL, RTP payload type and any out-of-band SPS/PPS. */
internal class VideoTrack(val control: String, val payloadType: Int, val parameterSets: List<ByteArray>)

/**
 * A minimal RTSP client for one H.264 track over RTP/UDP: what the transmitter's server needs and nothing
 * more (OPTIONS, DESCRIBE, SETUP, PLAY, OPTIONS as keep-alive, TEARDOWN).
 */
internal class Rtsp(network: Network?, private val url: String) {
  private val socket = Socket()
  private var cseq = 0
  private var session: String? = null
  private var base = url
  private val input: BufferedInputStream
  private val out by lazy { socket.getOutputStream() }

  init {
    network?.bindSocket(socket)
    val u = java.net.URI(url)
    socket.connect(InetSocketAddress(u.host, if (u.port > 0) u.port else 554), 3000)
    socket.soTimeout = 3000
    socket.tcpNoDelay = true
    input = BufferedInputStream(socket.getInputStream())
  }

  /** OPTIONS + DESCRIBE; the first H.264 video track of the SDP. */
  fun describe(): VideoTrack {
    request("OPTIONS", url)
    val r = request("DESCRIBE", url, listOf("Accept: application/sdp"))
    r.headers["content-base"]?.let { base = it }
    return parseSdp(String(r.body, Charsets.UTF_8)) ?: throw IOException("The stream has no H.264 video")
  }

  /** SETUP with our RTP/RTCP port pair; returns the server's RTCP port (or -1). */
  fun setup(track: VideoTrack, rtpPort: Int): Int {
    val r = request("SETUP", resolve(track.control), listOf("Transport: RTP/AVP/UDP;unicast;client_port=$rtpPort-${rtpPort + 1}"))
    session = r.headers["session"]?.substringBefore(';')?.trim() ?: throw IOException("RTSP SETUP: no session")
    val ports = Regex("server_port=(\\d+)-(\\d+)").find(r.headers["transport"] ?: "")
    return ports?.groupValues?.get(2)?.toInt() ?: -1
  }

  fun play() { request("PLAY", aggregate(), listOf("Range: npt=0.000-")) }

  /** Keeps the RTSP session open (the server's timeout is longer than our 30 s). */
  fun keepAlive() { request("OPTIONS", url) }

  /** Closes the connection without a TEARDOWN: safe from any thread, unblocks a pending read. */
  fun abort() {
    try { socket.close() } catch (_: IOException) {}
  }

  fun close() {
    try { if (session != null) send("TEARDOWN", aggregate(), emptyList()) } catch (_: IOException) {}
    try { socket.close() } catch (_: IOException) {}
  }

  private fun resolve(control: String): String = when {
    control.startsWith("rtsp://") -> control
    control == "*" -> aggregate()
    else -> base.trimEnd('/') + "/" + control
  }

  private fun aggregate(): String = base.trimEnd('/') + "/"

  private class Response(val status: Int, val headers: Map<String, String>, val body: ByteArray)

  private fun request(method: String, uri: String, headers: List<String> = emptyList()): Response {
    val mine = send(method, uri, headers)
    while (true) {
      val r = read()
      // Skips anything that is not the answer to this request (the server never sends requests here, but be safe).
      if (r.headers["cseq"]?.trim()?.toIntOrNull() != mine) continue
      if (r.status != 200) throw IOException("RTSP $method: ${r.status}")
      return r
    }
  }

  private fun send(method: String, uri: String, headers: List<String>): Int {
    val n = ++cseq
    val sb = StringBuilder("$method $uri RTSP/1.0\r\nCSeq: $n\r\nUser-Agent: OpenClapper\r\n")
    session?.let { sb.append("Session: ").append(it).append("\r\n") }
    for (h in headers) sb.append(h).append("\r\n")
    sb.append("\r\n")
    out.write(sb.toString().toByteArray(Charsets.US_ASCII))
    out.flush()
    return n
  }

  private fun read(): Response {
    val statusLine = line()
    val status = statusLine.split(' ').getOrNull(1)?.toIntOrNull() ?: throw IOException("RTSP: bad reply '$statusLine'")
    val headers = HashMap<String, String>()
    while (true) {
      val l = line()
      if (l.isEmpty()) break
      val i = l.indexOf(':')
      if (i > 0) headers[l.substring(0, i).trim().lowercase()] = l.substring(i + 1).trim()
    }
    val len = headers["content-length"]?.toIntOrNull() ?: 0
    val body = ByteArray(len)
    var got = 0
    while (got < len) {
      val n = input.read(body, got, len - got)
      if (n < 0) throw IOException("RTSP: connection closed")
      got += n
    }
    return Response(status, headers, body)
  }

  private fun line(): String {
    val b = ByteArrayOutputStream()
    while (true) {
      val c = input.read()
      if (c < 0) throw IOException("RTSP: connection closed")
      if (c == '\n'.code) break
      if (c != '\r'.code) b.write(c)
      if (b.size() > 8192) throw IOException("RTSP: line too long")
    }
    return b.toString("US-ASCII")
  }

  companion object {
    /** The first `m=video` section with an H.264 rtpmap. */
    fun parseSdp(sdp: String): VideoTrack? {
      var inVideo = false
      var pt = -1
      var control: String? = null
      var sets: List<ByteArray> = emptyList()
      fun done(): VideoTrack? = if (pt >= 0) VideoTrack(control ?: "*", pt, sets) else null
      for (raw in sdp.lines()) {
        val l = raw.trim()
        if (l.startsWith("m=")) {
          if (inVideo) done()?.let { return it }
          inVideo = l.startsWith("m=video")
          pt = -1; control = null; sets = emptyList()
          continue
        }
        if (!inVideo) continue
        when {
          l.startsWith("a=rtpmap:") && l.substringAfter(' ').startsWith("h264/", ignoreCase = true) ->
            pt = l.removePrefix("a=rtpmap:").substringBefore(' ').toIntOrNull() ?: -1
          l.startsWith("a=control:") -> control = l.removePrefix("a=control:")
          l.startsWith("a=fmtp:") -> {
            val sprop = Regex("sprop-parameter-sets=([^;\\s]+)").find(l)?.groupValues?.get(1)
            if (sprop != null) sets = sprop.split(',').mapNotNull { runCatching { Base64.decode(it, Base64.DEFAULT) }.getOrNull() }
          }
        }
      }
      return if (inVideo) done() else null
    }
  }
}
