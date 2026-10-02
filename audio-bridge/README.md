# virtual-audio-bridge 集成文档

`virtual-audio-bridge` 是一个 Windows 平台的 Node.js SDK，当前只对外暴露“完整通话录音”能力，适合作为软电话语音 Agent 的子模块集成。

本模块不暴露 RESTful API，也不对外暴露 TTS、ASR、普通录音等内部方法。

## 运行环境

- Windows
- Node.js 18+
- FFmpeg
- VB-CABLE 或兼容虚拟声卡

默认音频链路：

```text
软电话扬声器 -> CABLE Output -> 录音
Agent 语音 -> CABLE Input -> 软电话麦克风
```

完整通话录音会同时包含：

- 从 `CABLE Output` 录制的远端/用户声音
- Agent 在通话过程中播放的 TTS 语音

## 初始化

```js
const path = require('node:path');
const { VirtualAudioBridge } = require('./audio-bridge');

const audio = new VirtualAudioBridge({
  ffmpegPath: path.join(__dirname, 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe'),
  runtimeDir: path.join(__dirname, 'runtime', 'audio')
});
```

## 配置项

```js
const audio = new VirtualAudioBridge({
  ffmpegPath: 'ffmpeg',
  runtimeDir: './runtime/audio',
  inputDevice: 'audio=CABLE Output (VB-Audio Virtual Cable)',
  outputDevicePrefix: 'CABLE Input'
});
```

| 字段 | 必填 | 说明 |
|---|---:|---|
| `ffmpegPath` | 否 | FFmpeg 可执行文件路径，默认使用系统 PATH 中的 `ffmpeg` |
| `runtimeDir` | 否 | 录音输出目录，默认使用系统临时目录 |
| `inputDevice` | 否 | FFmpeg DirectShow 录音设备，默认是 `CABLE Output` |
| `outputDevicePrefix` | 否 | Windows 播放设备名称前缀，默认是 `CABLE Input` |

## 对外 API

### startCallRecording(options)

开始完整通话录音。

```js
const call = audio.startCallRecording({
  fileName: 'call-20261002-001',
  sampleRate: 16000,
  channels: 1,
  format: 'wav'
});
```

参数：

| 字段 | 必填 | 说明 |
|---|---:|---|
| `fileName` | 否 | 录音文件名前缀 |
| `sampleRate` | 否 | 采样率，默认 `16000` |
| `channels` | 否 | 声道数，默认 `1` |
| `format` | 否 | `wav` 或 `mp3`，默认 `wav` |

返回对象提供两个方法：

```js
call.speak({ text: '您好，请问有什么可以帮您？' });
const result = await call.stop({ fileName: 'call-20261002-001' });
```

### call.speak(options)

播放 Agent 语音，并自动把这段语音纳入完整通话录音。

```js
await call.speak({
  text: '您好，请问有什么可以帮您？',
  voice: 'Microsoft Huihui Desktop',
  rate: 0
});
```

### call.stop(options)

结束通话录音，并生成完整通话文件。

```js
const result = await call.stop({
  fileName: 'call-20261002-001'
});
```

返回：

```js
{
  callStartedAt: 1790907500000,
  callEndedAt: 1790907560000,
  remoteAudioFile: 'E:/project/runtime/audio/call-20261002-001-remote.wav',
  fullAudioFile: 'E:/project/runtime/audio/call-20261002-001-full.wav',
  metadataFile: 'E:/project/runtime/audio/call-20261002-001-full.wav.json',
  inputDevice: 'audio=CABLE Output (VB-Audio Virtual Cable)',
  sampleRate: 16000,
  channels: 1,
  format: 'wav',
  agentSegments: [
    {
      offsetSeconds: 0.123,
      text: '您好，请问有什么可以帮您？',
      voice: 'Microsoft Huihui Desktop',
      audioFile: 'E:/project/runtime/audio/speak-xxx.wav'
    }
  ]
}
```

## 推荐集成流程

```js
const audio = new VirtualAudioBridge({
  ffmpegPath: 'E:/virtual-voice/tools/ffmpeg/bin/ffmpeg.exe',
  runtimeDir: 'E:/virtual-voice/runtime/audio'
});

// 电话接通
const call = audio.startCallRecording({ fileName: 'call-001' });

// Agent 首句问候
await call.speak({ text: '您好，请问有什么可以帮您？' });

// Agent 后续回复
await call.speak({ text: '好的，我来为您处理。' });

// 电话挂断
const result = await call.stop({ fileName: 'call-001' });

console.log(result.fullAudioFile);
```

## 输出文件

每次完整通话会生成：

```text
<fileName>-remote.wav    远端/用户原始录音
<fileName>-full.wav      包含双方声音的完整通话录音
<fileName>-full.wav.json 通话元数据
```

如果没有 Agent 语音段，`fullAudioFile` 会直接等于远端录音文件。

## 沙箱和权限

在 Trae 沙箱中，Windows 语音组件可能需要写入：

```text
C:\Users\<user>\AppData\Local\speech
C:\Users\<user>\AppData\Local\Microsoft\Speech
C:\Users\<user>\AppData\Roaming\Microsoft\Speech
```

如果遇到：

```text
TRAE Sandbox Error: hit restricted
```

处理方式：

1. 使用非沙箱模式执行；或
2. 在 Trae 设置中把 `node`、`powershell` 加入命令白名单；或
3. 配置允许写入上述 Windows 语音目录。

## 注意事项

- 当前只暴露完整通话录音 API。
- 完整通话文件由远端录音和 Agent TTS 音频按时间偏移混音生成。
- `metadataFile` 可用于后续通话质检、转写或审计。
