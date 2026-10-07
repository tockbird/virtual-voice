# virtual-audio-bridge 集成文档

`virtual-audio-bridge` 是一个面向 Windows 的 Node.js SDK，用于把虚拟声卡链路封装成可复用的语音通话录音子模块。

当前对外只暴露“完整通话录音”能力：

- 从 `CABLE Output` 录制远端/用户声音
- 播放 Agent 的 TTS 语音到 `CABLE Input`
- 自动把 Agent 语音按时间偏移混入完整通话文件
- 输出通话录音和元数据，供质检、转写、审计使用

本模块不提供 RESTful API，也不对外暴露 TTS、ASR、普通录音等内部方法。

## 适用场景

适合集成到软电话语音 Agent 项目中，例如：

- 智能客服通话录音
- 电话外呼/呼入质检
- Agent 语音对话留档
- 通话审计与复核
- 后续 ASR/LLM 质检的输入音频采集

## 运行环境

- Windows 10/11
- Node.js 18 及以上
- FFmpeg
- VB-CABLE 或兼容虚拟声卡
- 中文 TTS/ASR 依赖 Windows 已安装的中文语音组件

## 集成环境搭建

### 1. 安装 Node.js

在 PowerShell 中检查：

```powershell
node --version
```

建议 Node.js 18 及以上。如果本机未安装，先安装 Node.js LTS，并确保 `node` 已加入系统 PATH。

如果 PowerShell 提示脚本执行被禁用，可以执行：

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### 2. 准备 FFmpeg

项目可以使用系统 PATH 中的 `ffmpeg`，也可以显式传入便携版路径：

```js
const audio = new VirtualAudioBridge({
  ffmpegPath: 'tools/ffmpeg/bin/ffmpeg.exe',
  runtimeDir: 'runtime/audio'
});
```

检查 FFmpeg 是否可用：

```powershell
tools/ffmpeg/bin/ffmpeg.exe -version
```

### 3. 安装并配置 VB-CABLE

安装 VB-CABLE 后重启电脑，然后在 Windows 声音设置中确认存在：

```text
CABLE Input
CABLE Output
```

推荐软电话配置：

| 软电话设置 | 选择设备 | 说明 |
|---|---|---|
| 麦克风 | `CABLE Output` | Agent TTS 会进入通话麦克风 |
| 扬声器/播放 | `CABLE Input` | 对端声音会进入 SDK 录音链路 |

如果软电话没有输出到 `CABLE Input`，SDK 可能只能录到 Agent 自己播放的声音，录不到用户/对端声音。

### 4. 确认中文语音组件

检查 Windows 中文语音包是否可用。模块内部使用 Windows SAPI 进行 TTS 和 ASR，需要系统已安装中文语音识别和中文 TTS 音色。

可以先用最小示例验证：

```js
const { VirtualAudioBridge } = require('./audio-bridge');

const audio = new VirtualAudioBridge({
  ffmpegPath: 'tools/ffmpeg/bin/ffmpeg.exe',
  runtimeDir: 'runtime/audio'
});

const call = audio.startCallRecording({ fileName: 'env-check' });

call.speak({
  text: '环境检查：虚拟声卡、FFmpeg 和中文语音组件均已就绪。'
}).then(() => call.stop({ fileName: 'env-check' }))
  .then((result) => console.log(result.fullAudioFile));
```

如果生成了 `env-check-full.wav`，说明基础链路可用。

### 5. 建议目录

集成方可以按下面方式组织：

```text
your-project/
  audio-bridge/
  tools/
    ffmpeg/
      bin/
        ffmpeg.exe
  runtime/
    audio/
```

然后初始化：

```js
const path = require('node:path');
const { VirtualAudioBridge } = require('./audio-bridge');

const audio = new VirtualAudioBridge({
  ffmpegPath: path.join(__dirname, 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe'),
  runtimeDir: path.join(__dirname, 'runtime', 'audio')
});
```

### 6. 权限和沙箱注意事项

如果在 Trae 沙箱中运行，Windows 语音组件可能被拦截。生产环境建议在普通 Windows 终端或服务中运行，不要依赖沙箱白名单。

如果必须在 Trae 中调试，可以把以下命令加入白名单：

```text
node
node.exe
powershell
powershell.exe
npm
npm.cmd
```

默认音频链路：

```text
软电话扬声器 -> CABLE Output -> SDK 录音
Agent TTS    -> CABLE Input  -> 软电话麦克风
```

完整通话录音由两部分组成：

1. `CABLE Output` 录到的用户/远端声音
2. Agent 在通话过程中播放的 TTS 语音

## 目录结构

```text
audio-bridge/
  index.js      SDK 主入口
  normalizer.js 中文 ASR 文本归一化与热词纠错
  package.json  子模块包信息
  README.md     本集成文档
```

## 快速集成

```js
const path = require('node:path');
const { VirtualAudioBridge } = require('./audio-bridge');

const audio = new VirtualAudioBridge({
  ffmpegPath: path.join(__dirname, 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe'),
  runtimeDir: path.join(__dirname, 'runtime', 'audio')
});
```

也可以使用工厂函数：

```js
const { createAudioBridge } = require('./audio-bridge');

const audio = createAudioBridge({
  ffmpegPath: 'tools/ffmpeg/bin/ffmpeg.exe',
  runtimeDir: 'runtime/audio'
});
```

## 初始化配置

```js
const audio = new VirtualAudioBridge({
  ffmpegPath: 'tools/ffmpeg/bin/ffmpeg.exe',
  runtimeDir: 'runtime/audio',
  inputDevice: 'audio=CABLE Output (VB-Audio Virtual Cable)',
  outputDevicePrefix: 'CABLE Input',
  asrCulture: 'zh-CN',
  addressAliases: {},
  regionAliases: {},
  termAliases: {}
});
```

| 字段 | 必填 | 默认值 | 说明 |
|---|---:|---|---|
| `ffmpegPath` | 否 | `ffmpeg` | FFmpeg 可执行文件路径。默认从系统 PATH 查找。 |
| `runtimeDir` | 否 | 系统临时目录 | 录音、TTS 音频和元数据输出目录。 |
| `inputDevice` | 否 | `audio=CABLE Output (VB-Audio Virtual Cable)` | FFmpeg DirectShow 录音设备。 |
| `outputDevicePrefix` | 否 | `CABLE Input` | Windows 播放设备名称前缀。 |
| `asrCulture` | 否 | `zh-CN` | 内部 Windows 语音识别语言。 |
| `addressAliases` | 否 | `{}` | 地址热词纠错词典。 |
| `regionAliases` | 否 | `{}` | 省市区等地名纠错词典。 |
| `termAliases` | 否 | `{}` | 业务术语、产品型号等同音词纠错词典。 |

## 对外 API

### `audio.startCallRecording(options)`

开始一次完整通话录音。

```js
const call = audio.startCallRecording({
  fileName: 'call-20261002-001',
  sampleRate: 16000,
  channels: 1,
  format: 'wav'
});
```

参数：

| 字段 | 必填 | 默认值 | 说明 |
|---|---:|---|---|
| `fileName` | 否 | 自动时间戳 | 输出文件名前缀。 |
| `sampleRate` | 否 | `16000` | 录音采样率。 |
| `channels` | 否 | `1` | 录音声道数。 |
| `format` | 否 | `wav` | 当前支持 `wav`。 |

返回的 `call` 对象提供：

```js
await call.speak({ text: '您好，请问有什么可以帮您？' });
const result = await call.stop({ fileName: 'call-20261002-001' });
```

### `call.speak(options)`

播放 Agent 语音到虚拟声卡，并自动把该段语音纳入完整通话录音。

```js
await call.speak({
  text: '您好，这里是华为智能客服，请问有什么可以帮您？',
  voice: 'Microsoft Huihui Desktop',
  rate: 0
});
```

参数：

| 字段 | 必填 | 默认值 | 说明 |
|---|---:|---|---|
| `text` | 是 | 无 | 需要合成并播放的文本。 |
| `voice` | 否 | 自动选择中文音色 | Windows TTS 音色名称。 |
| `rate` | 否 | `0` | 语速，取值遵循 Windows TTS 规则。 |

返回：

```js
{
  text: 'Agent 播放的文本',
  voice: 'Microsoft Huihui Desktop',
  audioFile: 'runtime/audio/speak-xxx.wav',
  offsetSeconds: 1.234
}
```

### `call.stop(options)`

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
  remoteAudioFile: 'runtime/audio/call-20261002-001-remote.wav',
  fullAudioFile: 'runtime/audio/call-20261002-001-full.wav',
  metadataFile: 'runtime/audio/call-20261002-001-full.wav.json',
  inputDevice: 'audio=CABLE Output (VB-Audio Virtual Cable)',
  sampleRate: 16000,
  channels: 1,
  format: 'wav',
  agentSegments: [
    {
      offsetSeconds: 0.123,
      text: '您好，请问有什么可以帮您？',
      voice: 'Microsoft Huihui Desktop',
      audioFile: 'runtime/audio/speak-xxx.wav'
    }
  ]
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `remoteAudioFile` | 从 `CABLE Output` 录到的远端/用户音频。 |
| `fullAudioFile` | 混音后的完整通话音频。 |
| `metadataFile` | Agent 语音段、时间偏移、文本等元数据。 |
| `agentSegments` | 本次通话中 Agent 播放过的语音段列表。 |

如果通话过程中没有 Agent 语音段，`fullAudioFile` 会直接等于远端录音文件。

## 完整通话示例

```js
const { VirtualAudioBridge } = require('./audio-bridge');

const audio = new VirtualAudioBridge({
  ffmpegPath: 'tools/ffmpeg/bin/ffmpeg.exe',
  runtimeDir: 'runtime/audio'
});

async function handleCall() {
  const call = audio.startCallRecording({ fileName: 'call-001' });

  await call.speak({
    text: '您好，这里是华为智能客服，请问有什么可以帮您？'
  });

  await call.speak({
    text: '好的，已为您记录安装地址和联系电话。'
  });

  const result = await call.stop({ fileName: 'call-001' });
  return result.fullAudioFile;
}
```

## 输出文件

每次 `call.stop()` 后会生成：

```text
<fileName>-remote.wav       远端/用户原始录音
<fileName>-full.wav         包含双方声音的完整通话录音
<fileName>-full.wav.json    通话元数据
```

TTS 临时音频默认也会保存在 `runtimeDir` 下，文件名以 `speak-` 开头。

## ASR 文本归一化和热词

模块内置了中文 ASR 后处理能力，当前主要用于内部识别结果归一化，也可以通过初始化配置扩展热词。

内置能力包括：

- 数字归一：`520元` -> `五百二十元`
- 时间归一：`10:00AM` -> `上午十点`
- 日期归一：`2026/10/02` -> `二零二六年十月二日`
- 电话归一：`13800138000` -> `一三八零零一三八零零零`
- 地址纠错：`菜鸟一站` -> `菜鸟驿站`
- 地名纠错：`朝阳去` -> `朝阳区`
- 业务热词：可自定义华为产品、服务中心、小区、街道等同音词纠错

示例：

```js
const audio = new VirtualAudioBridge({
  ffmpegPath: 'tools/ffmpeg/bin/ffmpeg.exe',
  runtimeDir: 'runtime/audio',
  addressAliases: {
    '菜鸟驿站的器械马': '菜鸟驿站的取件码'
  },
  regionAliases: {
    '朝阳去': '朝阳区'
  },
  termAliases: {
    '华为没薄田头': '华为 MateBook',
    '工程学': '工程师'
  }
});
```

热词适合修正 ASR 的同音字、格式差异和业务术语错误；如果原始音频识别偏差过大，仍建议接入云端 ASR。

## 虚拟声卡配置建议

Windows 软电话建议这样配置：

| 软电话设置 | 选择设备 | 用途 |
|---|---|---|
| 麦克风 | `CABLE Output` | Agent TTS 进入通话 |
| 扬声器/播放 | `CABLE Input` | 对端声音进入 SDK 录音 |

如果只把软电话扬声器设置为系统默认扬声器，而没有输出到 `CABLE Input`，SDK 可能录不到对端声音。


## 注意事项

- 当前只暴露完整通话录音相关 API。
- 完整通话文件由远端录音和 Agent TTS 音频按时间偏移混音生成。
- `metadataFile` 可用于后续通话质检、转写或审计。
- Windows 本地 ASR 准确率有限，热词只能提升后处理纠错能力，不能替代高质量 ASR 服务。
- 长通话建议定期落盘或外接专业录音服务，避免进程异常导致音频丢失。
