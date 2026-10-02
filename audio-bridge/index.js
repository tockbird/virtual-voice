'use strict';

const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { normalizeChineseSpokenText } = require('./normalizer');

function createTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

class VirtualAudioBridge {
  #recording = null;
  #callRecording = null;

  constructor(options = {}) {
    this.config = {
      ffmpegPath: options.ffmpegPath || 'ffmpeg',
      runtimeDir: options.runtimeDir || join(os.tmpdir(), 'virtual-audio-bridge'),
      inputDevice: options.inputDevice || 'audio=CABLE Output (VB-Audio Virtual Cable)',
      outputDevicePrefix: options.outputDevicePrefix || 'CABLE Input',
      asrCulture: options.asrCulture || 'zh-CN',
      addressAliases: options.addressAliases || {},
      regionAliases: options.regionAliases || {},
      termAliases: options.termAliases || {}
    };
  }

  #runFfmpeg(args, label) {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(this.config.ffmpegPath, args, { windowsHide: true });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) return resolvePromise(stderr);
        reject(new Error(`${label} 失败，退出码 ${code}\n${stderr}`));
      });
    });
  }

  #runPowershell(command, label, extraEnv = {}) {
    const utf8Command = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; chcp 65001 > $null; ${command}`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', utf8Command], {
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv },
      windowsHide: true
    });
    if (result.status !== 0) {
      throw new Error(`${label} 失败，退出码 ${result.status || 1}\n${result.stderr || result.stdout}`);
    }
    return (result.stdout || '').trim();
  }

  #playWavToOutputDevice(wavPath) {
    const powershell = String.raw`
$source = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public static class WaveOutPlayer {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public struct WAVEOUTCAPSA { public ushort wMid; public ushort wPid; public uint vDriverVersion; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname; public uint dwFormats; public ushort wChannels; public ushort wReserved; }
  [StructLayout(LayoutKind.Sequential)] public struct WAVEFORMATEX { public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec; public uint nAvgBytesPerSec; public ushort nBlockAlign; public ushort wBitsPerSample; public ushort cbSize; }
  [StructLayout(LayoutKind.Sequential)] public class WAVEHDR { public IntPtr lpData; public uint dwBufferLength; public uint dwBytesRecorded; public IntPtr dwUser; public uint dwFlags; public uint dwLoops; public IntPtr lpNext; public IntPtr reserved; }
  [DllImport("winmm.dll")] public static extern uint waveOutGetNumDevs();
  [DllImport("winmm.dll", CharSet = CharSet.Ansi)] public static extern uint waveOutGetDevCapsA(uint uDeviceID, ref WAVEOUTCAPSA pwoc, uint cbwoc);
  [DllImport("winmm.dll")] public static extern uint waveOutOpen(out IntPtr hwo, uint uDeviceID, ref WAVEFORMATEX pwfx, IntPtr dwCallback, IntPtr dwInstance, uint fdwOpen);
  [DllImport("winmm.dll")] public static extern uint waveOutPrepareHeader(IntPtr hwo, WAVEHDR pwh, uint cbwh);
  [DllImport("winmm.dll")] public static extern uint waveOutWrite(IntPtr hwo, WAVEHDR pwh, uint cbwh);
  [DllImport("winmm.dll")] public static extern uint waveOutUnprepareHeader(IntPtr hwo, WAVEHDR pwh, uint cbwh);
  [DllImport("winmm.dll")] public static extern uint waveOutClose(IntPtr hwo);
  public static int Play(string path, string prefix) {
    uint count = waveOutGetNumDevs();
    uint id = 0xffffffff;
    for (uint i = 0; i < count; i++) {
      var caps = new WAVEOUTCAPSA();
      if (waveOutGetDevCapsA(i, ref caps, (uint)Marshal.SizeOf(typeof(WAVEOUTCAPSA))) == 0 && caps.szPname.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) {
        id = i;
        break;
      }
    }
    if (id == 0xffffffff) return 2;
    byte[] data = File.ReadAllBytes(path);
    int channels = BitConverter.ToInt16(data, 22);
    int rate = BitConverter.ToInt32(data, 24);
    int bits = BitConverter.ToInt16(data, 34);
    int offset = 12;
    int dataOffset = 0;
    int dataSize = 0;
    while (offset + 8 <= data.Length) {
      string chunkId = Encoding.ASCII.GetString(data, offset, 4);
      int chunkSize = BitConverter.ToInt32(data, offset + 4);
      if (chunkId == "data") {
        dataOffset = offset + 8;
        dataSize = chunkSize;
        break;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
    if (dataOffset == 0 || dataSize <= 0 || dataOffset + dataSize > data.Length) return 6;
    var fmt = new WAVEFORMATEX { wFormatTag = 1, nChannels = (ushort)channels, nSamplesPerSec = (uint)rate, nAvgBytesPerSec = (uint)(rate * channels * bits / 8), nBlockAlign = (ushort)(channels * bits / 8), wBitsPerSample = (ushort)bits, cbSize = 0 };
    IntPtr handle;
    if (waveOutOpen(out handle, id, ref fmt, IntPtr.Zero, IntPtr.Zero, 0) != 0) return 3;
    IntPtr buffer = Marshal.AllocHGlobal(dataSize);
    Marshal.Copy(data, dataOffset, buffer, dataSize);
    var header = new WAVEHDR { lpData = buffer, dwBufferLength = (uint)dataSize };
    try {
      uint headerSize = (uint)Marshal.SizeOf(typeof(WAVEHDR));
      if (waveOutPrepareHeader(handle, header, headerSize) != 0) return 4;
      if (waveOutWrite(handle, header, headerSize) != 0) return 5;
      while ((header.dwFlags & 1) == 0) System.Threading.Thread.Sleep(20);
      return 0;
    } finally {
      uint headerSize = (uint)Marshal.SizeOf(typeof(WAVEHDR));
      waveOutUnprepareHeader(handle, header, headerSize);
      waveOutClose(handle);
      Marshal.FreeHGlobal(buffer);
    }
  }
}
'@
Add-Type -TypeDefinition $source -Language CSharp
exit [WaveOutPlayer]::Play($env:WAV_PATH, $env:WAV_DEVICE_PREFIX)
`;
    this.#runPowershell(powershell, '播放到虚拟声卡', {
      WAV_PATH: wavPath,
      WAV_DEVICE_PREFIX: this.config.outputDevicePrefix
    });
  }

  async #speak({ text, voice, rate }) {
    if (!text || typeof text !== 'string') throw new Error('缺少 text 字段');
    const trimmedText = text.trim();
    if (!trimmedText) throw new Error('text 不能为空');
    const startedAt = Date.now();

    mkdirSync(this.config.runtimeDir, { recursive: true });
    const output = join(this.config.runtimeDir, `speak-${createTimestamp()}.wav`);
    rmSync(output, { force: true });

    const ttsCommand = `
      Add-Type -AssemblyName System.Speech
      $synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
      try {
        $selectedVoice = $env:TTS_VOICE
        if ([string]::IsNullOrWhiteSpace($selectedVoice) -and $env:TTS_TEXT -match '[一-鿿]') {
          $zhVoice = $synthesizer.GetInstalledVoices((New-Object System.Globalization.CultureInfo 'zh-CN')) | Select-Object -First 1
          if ($zhVoice) { $selectedVoice = $zhVoice.VoiceInfo.Name }
        }
        if ([string]::IsNullOrWhiteSpace($selectedVoice)) {
          $firstVoice = $synthesizer.GetInstalledVoices() | Select-Object -First 1
          if ($firstVoice) { $selectedVoice = $firstVoice.VoiceInfo.Name }
        }
        if (-not [string]::IsNullOrWhiteSpace($selectedVoice)) { $synthesizer.SelectVoice($selectedVoice) }
        $synthesizer.Rate = [Math]::Max(-10, [Math]::Min(10, [int]$env:TTS_RATE))
        $synthesizer.SetOutputToWaveFile($env:TTS_OUTPUT)
        $synthesizer.Speak($env:TTS_TEXT)
        [Console]::Out.Write($selectedVoice)
      } finally {
        $synthesizer.Dispose()
      }
    `;
    const selectedVoice = this.#runPowershell(ttsCommand, 'Windows TTS 合成', {
      TTS_TEXT: trimmedText,
      TTS_VOICE: voice || '',
      TTS_RATE: String(Number.isFinite(rate) ? rate : 0),
      TTS_OUTPUT: output
    });
    if (!existsSync(output)) throw new Error('TTS 合成完成，但未生成音频文件');

    this.#playWavToOutputDevice(output);
    const result = { text: trimmedText, voice: selectedVoice || 'default', audioFile: output };

    if (this.#callRecording) {
      this.#callRecording.agentSegments.push({
        offsetSeconds: Number(((startedAt - this.#callRecording.startedAt) / 1000).toFixed(3)),
        text: trimmedText,
        voice: result.voice,
        audioFile: output
      });
    }

    return result;
  }

  #startRecording(options = {}) {
    if (this.#recording) throw new Error('已有录音任务正在进行，请先停止当前录音');

    const sampleRate = Number(options.sampleRate || 16000);
    const channels = Number(options.channels || 1);
    const format = options.format === 'mp3' ? 'mp3' : 'wav';
    const safeName = String(options.fileName || `call-${createTimestamp()}`).replace(/[^\w.-]+/g, '_');
    const output = join(this.config.runtimeDir, `${safeName}.${format}`);

    mkdirSync(this.config.runtimeDir, { recursive: true });
    rmSync(output, { force: true });

    const args = ['-hide_banner', '-y', '-f', 'dshow', '-i', this.config.inputDevice, '-ar', String(sampleRate), '-ac', String(channels)];
    if (format === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', '128k');
    else args.push('-c:a', 'pcm_s16le');
    args.push(output);

    const child = spawn(this.config.ffmpegPath, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const done = new Promise((resolvePromise, reject) => {
      child.on('error', reject);
      child.on('close', (code) => {
        if (this.#recording && this.#recording.child === child) this.#recording = null;
        if (code === 0 || code === 255) return resolvePromise(stderr);
        reject(new Error(`录音失败，退出码 ${code}\n${stderr}`));
      });
    });

    this.#recording = { child, output, startedAt: Date.now(), sampleRate, channels, format, done };
    return {
      audioFile: output,
      startedAt: this.#recording.startedAt,
      inputDevice: this.config.inputDevice,
      sampleRate,
      channels,
      format
    };
  }

  async #stopRecording() {
    const recording = this.#recording;
    if (!recording) throw new Error('当前没有正在进行的录音');
    this.#recording = null;

    try {
      recording.child.stdin.write('q');
      recording.child.stdin.end();
    } catch {}

    await recording.done;
    if (!existsSync(recording.output)) throw new Error('录音已停止，但未生成音频文件');

    const endedAt = Date.now();
    return {
      audioFile: recording.output,
      startedAt: recording.startedAt,
      endedAt,
      durationMs: endedAt - recording.startedAt,
      durationSeconds: Number(((endedAt - recording.startedAt) / 1000).toFixed(3)),
      sampleRate: recording.sampleRate,
      channels: recording.channels,
      format: recording.format,
      inputDevice: this.config.inputDevice
    };
  }

  async #record({ duration, fileName, sampleRate = 16000, channels = 1, format = 'wav' } = {}) {
    const seconds = Number(duration);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 24 * 60 * 60) {
      throw new Error('duration 必须是 1 到 86400 之间的数字');
    }

    const startedAt = Date.now();
    const safeName = String(fileName || `call-${createTimestamp()}`).replace(/[^\w.-]+/g, '_');
    const output = join(this.config.runtimeDir, `${safeName}.${format === 'mp3' ? 'mp3' : 'wav'}`);
    mkdirSync(this.config.runtimeDir, { recursive: true });
    rmSync(output, { force: true });

    const args = ['-hide_banner', '-y', '-f', 'dshow', '-i', this.config.inputDevice, '-t', String(seconds), '-ar', String(sampleRate), '-ac', String(channels)];
    if (format === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', '128k');
    else args.push('-c:a', 'pcm_s16le');
    args.push(output);

    await this.#runFfmpeg(args, '录制通话内容');
    if (!existsSync(output)) throw new Error('录音完成，但未生成音频文件');

    const endedAt = Date.now();
    return {
      audioFile: output,
      duration: seconds,
      durationMs: endedAt - startedAt,
      sampleRate,
      channels,
      format: format === 'mp3' ? 'mp3' : 'wav',
      inputDevice: this.config.inputDevice
    };
  }

  startCallRecording(options = {}) {
    if (this.#callRecording) throw new Error('已有完整通话录音正在进行');
    const started = this.#startRecording({
      fileName: options.fileName ? `${options.fileName}-remote` : `call-${createTimestamp()}-remote`,
      sampleRate: options.sampleRate || 16000,
      channels: options.channels || 1,
      format: options.format === 'mp3' ? 'mp3' : 'wav'
    });
    this.#callRecording = {
      startedAt: started.startedAt,
      remoteAudioFile: started.audioFile,
      sampleRate: started.sampleRate,
      channels: started.channels,
      format: started.format,
      agentSegments: []
    };
    return {
      callStartedAt: this.#callRecording.startedAt,
      remoteAudioFile: this.#callRecording.remoteAudioFile,
      inputDevice: started.inputDevice,
      sampleRate: this.#callRecording.sampleRate,
      channels: this.#callRecording.channels,
      format: this.#callRecording.format,
      recordingAgentSpeech: true,
      speak: (speakOptions) => this.#speak(speakOptions),
      stop: (stopOptions) => this.stopCallRecording(stopOptions)
    };
  }

  async stopCallRecording(options = {}) {
    const call = this.#callRecording;
    if (!call) throw new Error('当前没有正在进行的完整通话录音');
    this.#callRecording = null;

    const stopped = await this.#stopRecording();
    const remoteAudioFile = stopped.audioFile;
    const mixedAudioFile = join(this.config.runtimeDir, `${String(options.fileName || `call-${createTimestamp()}`).replace(/[^\w.-]+/g, '_')}-full.${call.format}`);
    rmSync(mixedAudioFile, { force: true });

    let fullAudioFile = remoteAudioFile;
    if (call.agentSegments.length > 0) {
      const inputs = ['-i', remoteAudioFile];
      const labels = ['[a0]'];
      const filters = ['[0:a]aformat=sample_fmts=fltp:sample_rates=16000:channel_layouts=mono,asetpts=PTS-STARTPTS[a0]'];

      call.agentSegments.forEach((segment, index) => {
        const delayMs = Math.max(0, Math.round(segment.offsetSeconds * 1000));
        inputs.push('-i', segment.audioFile);
        labels.push(`[a${index + 1}]`);
        filters.push(`[${index + 1}:a]aformat=sample_fmts=fltp:sample_rates=16000:channel_layouts=mono,adelay=${delayMs}|${delayMs},asetpts=PTS-STARTPTS[a${index + 1}]`);
      });

      filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,volume=2[aout]`);
      await this.#runFfmpeg([
        '-hide_banner', '-y',
        ...inputs,
        '-filter_complex', filters.join(';'),
        '-map', '[aout]',
        '-ar', String(call.sampleRate),
        '-ac', String(call.channels),
        '-c:a', call.format === 'mp3' ? 'libmp3lame' : 'pcm_s16le',
        mixedAudioFile
      ], '合成完整通话录音');
      if (!existsSync(mixedAudioFile)) throw new Error('完整通话录音合成失败');
      fullAudioFile = mixedAudioFile;
    }

    const metadata = {
      callStartedAt: call.startedAt,
      callEndedAt: stopped.endedAt,
      remoteAudioFile,
      fullAudioFile,
      inputDevice: stopped.inputDevice,
      sampleRate: stopped.sampleRate,
      channels: stopped.channels,
      format: stopped.format,
      agentSegments: call.agentSegments
    };
    writeFileSync(`${fullAudioFile}.json`, JSON.stringify(metadata, null, 2), 'utf8');

    return {
      ...metadata,
      metadataFile: `${fullAudioFile}.json`
    };
  }

  #transcribeFile(inputFile, culture = this.config.asrCulture) {
    const file = resolve(String(inputFile));
    if (!existsSync(file)) throw new Error(`音频文件不存在: ${file}`);
    const asrCommand = `
      Add-Type -AssemblyName System.Speech
      $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine (New-Object System.Globalization.CultureInfo $env:ASR_CULTURE)
      try {
        $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
        $engine.SetInputToWaveFile($env:ASR_INPUT)
        $result = $engine.Recognize()
        if ($result) { [Console]::Out.Write($result.Text) }
      } finally {
        $engine.Dispose()
      }
    `;
    const rawText = this.#runPowershell(asrCommand, 'Windows 语音识别', {
      ASR_INPUT: file,
      ASR_CULTURE: culture
    });
    return normalizeChineseSpokenText(rawText, {
      addressAliases: this.config.addressAliases,
      regionAliases: this.config.regionAliases,
      termAliases: this.config.termAliases
    });
  }

  async #listen({ duration = 8, culture = this.config.asrCulture, audioFile, mockTranscript } = {}) {
    let output;
    let fromRecording = false;

    if (audioFile) {
      output = resolve(String(audioFile));
      if (mockTranscript !== undefined) {
        return { text: String(mockTranscript), audioFile: output, fromRecording: false, simulated: true };
      }
    } else {
      const seconds = Number(duration);
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60) {
        throw new Error('duration 必须是 1 到 60 之间的数字');
      }

      mkdirSync(this.config.runtimeDir, { recursive: true });
      output = join(this.config.runtimeDir, `listen-${createTimestamp()}.wav`);
      rmSync(output, { force: true });
      fromRecording = true;

      await this.#runFfmpeg([
        '-hide_banner', '-y',
        '-f', 'dshow', '-i', this.config.inputDevice,
        '-t', String(seconds),
        '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
        output
      ], '录制虚拟声卡输入');
      if (!existsSync(output)) throw new Error('录音完成，但未生成音频文件');
    }

    const text = this.#transcribeFile(output, culture);
    return { text, duration: audioFile ? undefined : Number(duration), audioFile: output, fromRecording };
  }
}

function createAudioBridge(options = {}) {
  return new VirtualAudioBridge(options);
}

module.exports = { VirtualAudioBridge, createAudioBridge };
