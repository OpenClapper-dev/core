package org.openclapper.videolink

import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Build
import android.view.Surface
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/** Counters the view reports once a second. */
internal class Stats {
  val frames = AtomicInteger()
  val dropped = AtomicInteger()
  val latencyUs = AtomicLong()
  val inputs = AtomicInteger()
  @Volatile var started = false
}

/**
 * The hardware H.264 decoder, rendering every frame the moment it is out: no jitter buffer, no clock,
 * low-latency mode where the decoder has one. Input runs on the caller's (network) thread, output on
 * its own thread.
 */
internal class Decoder(private val surface: Surface, private val stats: Stats, private val onSize: (Int, Int) -> Unit) {
  private var codec: MediaCodec? = null
  private var output: Thread? = null
  private var configuredSps: ByteArray? = null
  @Volatile private var running = false

  /** Queues one frame, stamped with its arrival time; drops it rather than wait when the decoder is full. */
  fun feed(au: AccessUnit, arrivalUs: Long) {
    val sps = au.sps
    val pps = au.pps
    if (codec != null && sps != null && !sps.contentEquals(configuredSps)) stop() // new resolution or profile
    if (codec == null) {
      // Starts on the parameter sets, not on an IDR: a low-latency stream may refresh gradually and never send one.
      if (sps == null || pps == null) return
      stats.started = true
      start(sps, pps)
    }
    val c = codec ?: return
    val idx = c.dequeueInputBuffer(5_000)
    if (idx < 0) { stats.dropped.incrementAndGet(); return }
    val buf = c.getInputBuffer(idx) ?: return
    buf.clear()
    if (au.size > buf.capacity()) {
      c.queueInputBuffer(idx, 0, 0, arrivalUs, 0)
      stats.dropped.incrementAndGet()
      return
    }
    buf.put(au.data, 0, au.size)
    c.queueInputBuffer(idx, 0, au.size, arrivalUs, 0)
    stats.inputs.incrementAndGet()
  }

  private fun start(sps: ByteArray, pps: ByteArray) {
    val f = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, 1920, 1080)
    f.setByteBuffer("csd-0", java.nio.ByteBuffer.wrap(byteArrayOf(0, 0, 0, 1) + sps))
    f.setByteBuffer("csd-1", java.nio.ByteBuffer.wrap(byteArrayOf(0, 0, 0, 1) + pps))
    f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 2 * 1024 * 1024)
    f.setInteger(MediaFormat.KEY_PRIORITY, 0) // real time
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) f.setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
    val c = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    c.configure(f, surface, null, 0)
    c.start()
    codec = c
    configuredSps = sps
    running = true
    output = Thread({ drain(c) }, "video-link-out").apply { isDaemon = true; start() }
  }

  private fun drain(c: MediaCodec) {
    val info = MediaCodec.BufferInfo()
    while (running) {
      val i = try { c.dequeueOutputBuffer(info, 10_000) } catch (_: IllegalStateException) { return }
      when {
        i >= 0 -> {
          c.releaseOutputBuffer(i, true)
          stats.frames.incrementAndGet()
          stats.latencyUs.addAndGet(System.nanoTime() / 1000 - info.presentationTimeUs)
        }
        i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          val o = c.outputFormat
          val w = if (o.containsKey("crop-right")) o.getInteger("crop-right") - o.getInteger("crop-left") + 1 else o.getInteger(MediaFormat.KEY_WIDTH)
          val h = if (o.containsKey("crop-bottom")) o.getInteger("crop-bottom") - o.getInteger("crop-top") + 1 else o.getInteger(MediaFormat.KEY_HEIGHT)
          onSize(w, h)
        }
      }
    }
  }

  fun stop() {
    running = false
    output?.join(200)
    output = null
    codec?.let { c ->
      try { c.stop() } catch (_: IllegalStateException) {}
      c.release()
    }
    codec = null
    configuredSps = null
  }
}
