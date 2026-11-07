package org.openclapper.videolink

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The live picture of a Hollyland Mars transmitter (#302); see VideoLinkView and docs/features/live-picture.md. */
class VideoLinkModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VideoLink")

    View(VideoLinkView::class) {
      Events("onStatus")
      Prop("host") { view: VideoLinkView, host: String -> view.host = host }
      Prop("active") { view: VideoLinkView, active: Boolean -> view.active = active }
    }
  }
}
