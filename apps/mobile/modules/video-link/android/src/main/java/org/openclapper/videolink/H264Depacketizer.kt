package org.openclapper.videolink

/** One access unit (a frame) in Annex-B form, ready for the decoder. `data` is valid until the next packet. */
internal class AccessUnit(val data: ByteArray, val size: Int, val key: Boolean, val sps: ByteArray?, val pps: ByteArray?)

/**
 * RTP → H.264 access units (RFC 6184: single NAL units, STAP-A and FU-A, which is what packetization-mode 1
 * allows). A frame ends with the marker bit or when the timestamp changes. A lost packet drops only the
 * fragmented NAL it belonged to; the decoder conceals the rest instead of the picture freezing until the
 * next key frame.
 */
internal class H264Depacketizer(private val payloadType: Int, parameterSets: List<ByteArray>) {
  private var buf = ByteArray(512 * 1024)
  private var size = 0
  private var key = false
  private var timestamp = -1L
  private var expectedSeq = -1
  private var fuActive = false
  private var fuBroken = false
  private var fuStart = 0

  /** The latest SPS/PPS seen, in-band or from the SDP; the decoder is configured from them. */
  var sps: ByteArray? = null
    private set
  var pps: ByteArray? = null
    private set

  /** Packets missing by sequence number, since the start. */
  var lost = 0
    private set

  init { for (p in parameterSets) remember(p, 0, p.size) }

  /** Feeds one RTP packet; calls [emit] for every access unit it completes. */
  fun push(p: ByteArray, len: Int, emit: (AccessUnit) -> Unit) {
    if (len < 12 || (p[0].toInt() and 0xc0) != 0x80) return
    if ((p[1].toInt() and 0x7f) != payloadType) return
    val marker = (p[1].toInt() and 0x80) != 0
    val seq = ((p[2].toInt() and 0xff) shl 8) or (p[3].toInt() and 0xff)
    val ts = ((p[4].toLong() and 0xff) shl 24) or ((p[5].toLong() and 0xff) shl 16) or ((p[6].toLong() and 0xff) shl 8) or (p[7].toLong() and 0xff)
    var off = 12 + 4 * (p[0].toInt() and 0x0f)
    if ((p[0].toInt() and 0x10) != 0) {
      if (off + 4 > len) return
      off += 4 + 4 * (((p[off + 2].toInt() and 0xff) shl 8) or (p[off + 3].toInt() and 0xff))
    }
    var end = len
    if ((p[0].toInt() and 0x20) != 0) end -= p[len - 1].toInt() and 0xff
    if (off >= end) return

    if (expectedSeq >= 0 && seq != expectedSeq) {
      val gap = (seq - expectedSeq) and 0xffff
      if (gap in 1..0x7fff) { lost += gap; if (fuActive) fuBroken = true } else return // late or duplicate
    }
    expectedSeq = (seq + 1) and 0xffff

    if (timestamp >= 0 && ts != timestamp && size > 0) flush(emit)
    timestamp = ts

    val type = p[off].toInt() and 0x1f
    when (type) {
      in 1..23 -> nal(p, off, end - off)
      24 -> { // STAP-A
        var i = off + 1
        while (i + 2 <= end) {
          val n = ((p[i].toInt() and 0xff) shl 8) or (p[i + 1].toInt() and 0xff)
          i += 2
          if (n == 0 || i + n > end) break
          nal(p, i, n)
          i += n
        }
      }
      28 -> { // FU-A
        if (off + 2 > end) return
        val fu = p[off + 1].toInt()
        val start = (fu and 0x80) != 0
        val stop = (fu and 0x40) != 0
        if (start) {
          fuActive = true
          fuBroken = false
          fuStart = size
          startCode()
          append(((p[off].toInt() and 0xe0) or (fu and 0x1f)).toByte())
        } else if (!fuActive) {
          return
        }
        if (!fuBroken) append(p, off + 2, end - off - 2)
        if (stop) {
          fuActive = false
          if (fuBroken) size = fuStart else noted(fuStart + 4)
        }
      }
    }
    if (marker) flush(emit)
  }

  private fun flush(emit: (AccessUnit) -> Unit) {
    if (fuActive) { size = fuStart; fuActive = false }
    if (size > 0) emit(AccessUnit(buf, size, key, sps, pps))
    size = 0
    key = false
  }

  private fun nal(p: ByteArray, at: Int, n: Int) {
    val start = size
    startCode()
    append(p, at, n)
    noted(start + 4)
  }

  /** Records the NAL just written at [at] (after its start code): key frame, SPS, PPS. */
  private fun noted(at: Int) {
    if (at >= size) return
    when (buf[at].toInt() and 0x1f) {
      5 -> key = true
      7, 8 -> remember(buf, at, size - at)
    }
  }

  private fun remember(b: ByteArray, at: Int, n: Int) {
    if (n <= 0) return
    val copy = b.copyOfRange(at, at + n)
    when (copy[0].toInt() and 0x1f) {
      7 -> sps = copy
      8 -> pps = copy
    }
  }

  private fun startCode() { ensure(4); buf[size] = 0; buf[size + 1] = 0; buf[size + 2] = 0; buf[size + 3] = 1; size += 4 }
  private fun append(b: Byte) { ensure(1); buf[size++] = b }
  private fun append(b: ByteArray, at: Int, n: Int) { if (n <= 0) return; ensure(n); b.copyInto(buf, size, at, at + n); size += n }
  private fun ensure(n: Int) { if (size + n > buf.size) buf = buf.copyOf(maxOf(buf.size * 2, size + n)) }
}
