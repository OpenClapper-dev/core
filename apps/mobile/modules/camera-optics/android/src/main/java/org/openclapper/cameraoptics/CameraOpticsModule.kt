package org.openclapper.cameraoptics

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.hypot

/**
 * Each camera's optics as Camera2 reports them (#426). The camera library gives only the physical focal length
 * (LENS_INFO_AVAILABLE_FOCAL_LENGTHS, 7.1 mm on a phone's main lens), so the 35 mm equivalent is worked out here:
 * focal length × 43.27 mm ÷ the diagonal of the sensor's active area (SENSOR_INFO_PHYSICAL_SIZE scaled from the
 * pixel array to the active array), the same crop factor a phone writes into a photo's EXIF.
 */
class CameraOpticsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CameraOptics")

    Function("lenses") {
      val context: Context = appContext.reactContext ?: return@Function emptyList<Map<String, Any?>>()
      val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val seen = LinkedHashSet<String>()
      val out = ArrayList<Map<String, Any?>>()
      fun add(id: String) {
        if (!seen.add(id)) return
        val c = try { manager.getCameraCharacteristics(id) } catch (_: Exception) { return }
        val focal = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull()?.toDouble()
        val size = c.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
        val pixels = c.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
        val active = c.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
        var w = size?.width?.toDouble()
        var h = size?.height?.toDouble()
        if (w != null && h != null && pixels != null && active != null && pixels.width > 0 && pixels.height > 0) {
          w *= active.width().toDouble() / pixels.width
          h *= active.height().toDouble() / pixels.height
        }
        val diag = if (w != null && h != null) hypot(w, h) else null
        val focal35 = if (focal != null && diag != null && diag > 0) focal * 43.27 / diag else null
        out.add(mapOf("id" to id, "focal" to focal, "sensorW" to w, "sensorH" to h, "focal35" to focal35))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) c.physicalCameraIds.forEach { add(it) }
      }
      manager.cameraIdList.forEach { add(it) }
      out
    }
  }
}
