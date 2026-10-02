'use strict';

const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');

function createTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

class VirtualAudioBridge {
  constructor(options = {}) {
    this.config = {
      ffmpegPath: options.ffmpegPath || 'ffmpeg',
      runtimeDir: options.runtimeDir || join(os.tmpdir(), 'virtual-audio-bridge'),
      inputDevice: options.inputDevice || 'audio=CABLE Output (VB-Audio Virtual Cable)',
      outputDevicePrefix: options.outputDevicePrefix || 'CABLE Input',
      asrCulture: options.asrCulture || 'zh-CN'
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

  async speak({ text, voice, rate }) {
    if (!text || typeof text !== 'string') throw new Error('缺少 text 字段');
    const trimmedText = text.trim();
    if (!trimmedText) throw new Error('text 不能为空');

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
    return { text: trimmedText, voice: selectedVoice || 'default', audioFile: output };
  }

  transcribeFile(inputFile, culture = this.config.asrCulture) {
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
    return this.#runPowershell(asrCommand, 'Windows 语音识别', {
      ASR_INPUT: file,
      ASR_CULTURE: culture
    });
  }

  async listen({ duration = 8, culture = this.config.asrCulture, audioFile, mockTranscript } = {}) {
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

    const text = this.transcribeFile(output, culture);
    return { text, duration: audioFile ? undefined : Number(duration), audioFile: output, fromRecording };
  }
}

function createAudioBridge(options = {}) {
  return new VirtualAudioBridge(options);
}

module.exports = { VirtualAudioBridge, createAudioBridge };
