package org.aiforall.ytube_download

import android.content.Intent
import androidx.core.content.FileProvider
import com.antonkarpenko.ffmpegkit.FFmpegKit
import com.antonkarpenko.ffmpegkit.ReturnCode
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "org.aiforall.ytube_download/ffmpeg",
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "run" -> {
                    val args = call.argument<List<String>>("args")
                    if (args == null) {
                        result.error("bad_args", "ffmpeg args missing", null)
                        return@setMethodCallHandler
                    }
                    try {
                        val session = FFmpegKit.executeWithArguments(args.toTypedArray())
                        val code = session.returnCode
                        result.success(if (ReturnCode.isSuccess(code)) 0 else (code?.value ?: 1))
                    } catch (e: Exception) {
                        result.error("ffmpeg", e.message, null)
                    }
                }
                "play" -> {
                    val path = call.argument<String>("path")
                    if (path.isNullOrEmpty()) {
                        result.error("bad_args", "path missing", null)
                        return@setMethodCallHandler
                    }
                    try {
                        val file = File(path)
                        val uri = FileProvider.getUriForFile(
                            this,
                            "$packageName.fileprovider",
                            file,
                        )
                        val mime = when {
                            path.endsWith(".mp3", true) -> "audio/mpeg"
                            path.endsWith(".m4a", true) -> "audio/mp4"
                            else -> "video/mp4"
                        }
                        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        startActivity(intent)
                        result.success(null)
                    } catch (e: Exception) {
                        result.error("play", e.message, null)
                    }
                }
                else -> result.notImplemented()
            }
        }
    }
}
