package org.openclapper.videolink

import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView
import android.view.View
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** The picture, letterboxed into the view; the session runs while `active`, attached and the surface exists. */
class VideoLinkView(context: Context, appContext: AppContext) : ExpoView(context, appContext), TextureView.SurfaceTextureListener {
  private val onStatus by EventDispatcher()
  private val texture = TextureView(context)
  private var surface: Surface? = null
  private var session: LinkSession? = null
  private var videoW = 0
  private var videoH = 0

  var host: String = "192.168.218.10"
    set(v) { if (v != field) { field = v; restart() } }
  var active: Boolean = false
    set(v) { if (v != field) { field = v; restart() } }

  init {
    texture.surfaceTextureListener = this
    addView(texture)
  }

  // React Native lays out this view but not its native child.
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    val w = r - l
    val h = b - t
    texture.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
    texture.layout(0, 0, w, h)
    fit()
  }

  private fun fit() {
    val w = texture.width.toFloat()
    val h = texture.height.toFloat()
    if (w <= 0 || h <= 0 || videoW <= 0 || videoH <= 0) return
    val scale = minOf(w / videoW, h / videoH)
    val m = Matrix()
    m.setScale(videoW * scale / w, videoH * scale / h, w / 2, h / 2)
    texture.setTransform(m)
  }

  private fun restart() {
    session?.stop()
    session = null
    val s = surface ?: return
    if (!active || !isAttachedToWindow) return
    session = LinkSession(
      context, host, s,
      status = { m -> post { onStatus(m) } },
      onSize = { w, h -> post { videoW = w; videoH = h; fit(); onStatus(mapOf("state" to "playing", "width" to w, "height" to h)) } },
    ).also { it.start() }
  }

  override fun onAttachedToWindow() { super.onAttachedToWindow(); restart() }
  override fun onDetachedFromWindow() { session?.stop(); session = null; super.onDetachedFromWindow() }

  override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
    surface = Surface(st)
    restart()
  }

  override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) = fit()

  override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
    session?.stop()
    session = null
    surface?.release()
    surface = null
    return true
  }

  override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
}
