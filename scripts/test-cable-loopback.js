'use strict';

/**
 * 验证 VB-CABLE 回环：把测试音播放到 CABLE Input，再从 CABLE Output 录音。
 * 用法: node scripts/test-cable-loopback.js
 */

const { spawn, spawnSync } = require('node:child_process');
const { mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { resolveFfmpeg } = require('../lib/ffmpeg');

const ffmpeg = resolveFfmpeg();
const toolsDir = join(__dirname, '..', 'tools');
const toneFile = join(toolsDir, 'cable-loopback-tone.wav');
const recordedFile = join(toolsDir, 'cable-loopback-capture.wav');
const recordSeconds = 5;

function runFfmpeg(args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(stderr);
      reject(new Error(`${label} 失败，退出码 ${code}\n${stderr}`));
    });
  });
}

function playToCableInput(wavPath) {
  const powershell = `$source = @'\nusing System;\nusing System.IO;\nusing System.Runtime.InteropServices;\npublic static class WaveOutPlayer {\n  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]\n  public struct WAVEOUTCAPSA { public ushort wMid; public ushort wPid; public uint vDriverVersion; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname; public uint dwFormats; public ushort wChannels; public ushort wReserved; }\n  [StructLayout(LayoutKind.Sequential)] public struct WAVEFORMATEX { public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec; public uint nAvgBytesPerSec; public ushort nBlockAlign; public ushort wBitsPerSample; public ushort cbSize; }\n  [StructLayout(LayoutKind.Sequential)] public class WAVEHDR { public IntPtr lpData; public uint dwBufferLength; public uint dwBytesRecorded; public IntPtr dwUser; public uint dwFlags; public uint dwLoops; public IntPtr lpNext; public IntPtr reserved; }\n  [DllImport("winmm.dll")] public static extern uint waveOutGetNumDevs();\n  [DllImport("winmm.dll", CharSet = CharSet.Ansi)] public static extern uint waveOutGetDevCapsA(uint uDeviceID, ref WAVEOUTCAPSA pwoc, uint cbwoc);\n  [DllImport("winmm.dll")] public static extern uint waveOutOpen(out IntPtr hwo, uint uDeviceID, ref WAVEFORMATEX pwfx, IntPtr dwCallback, IntPtr dwInstance, uint fdwOpen);\n  [DllImport("winmm.dll")] public static extern uint waveOutPrepareHeader(IntPtr hwo, WAVEHDR pwh, uint cbwh);\n  [DllImport("winmm.dll")] public static extern uint waveOutWrite(IntPtr hwo, WAVEHDR pwh, uint cbwh);\n  [DllImport("winmm.dll")] public static extern uint waveOutUnprepareHeader(IntPtr hwo, WAVEHDR pwh, uint cbwh);\n  [DllImport("winmm.dll")] public static extern uint waveOutClose(IntPtr hwo);\n  public static int Play(string path, string prefix) {\n    uint count = waveOutGetNumDevs();\n    uint id = 0xffffffff;\n    for (uint i = 0; i < count; i++) {\n      var caps = new WAVEOUTCAPSA();\n      if (waveOutGetDevCapsA(i, ref caps, (uint)Marshal.SizeOf(typeof(WAVEOUTCAPSA))) == 0 && caps.szPname.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) {\n        id = i;\n        break;\n      }\n    }\n    if (id == 0xffffffff) return 2;\n    byte[] data = File.ReadAllBytes(path);\n    int channels = BitConverter.ToInt16(data, 22);\n    int rate = BitConverter.ToInt32(data, 24);\n    int bits = BitConverter.ToInt16(data, 34);\n    int dataSize = BitConverter.ToInt32(data, 40);\n    var fmt = new WAVEFORMATEX { wFormatTag = 1, nChannels = (ushort)channels, nSamplesPerSec = (uint)rate, nAvgBytesPerSec = (uint)(rate * channels * bits / 8), nBlockAlign = (ushort)(channels * bits / 8), wBitsPerSample = (ushort)bits, cbSize = 0 };\n    IntPtr handle;\n    if (waveOutOpen(out handle, id, ref fmt, IntPtr.Zero, IntPtr.Zero, 0) != 0) return 3;\n    IntPtr buffer = Marshal.AllocHGlobal(dataSize);\n    Marshal.Copy(data, 44, buffer, dataSize);\n    var header = new WAVEHDR { lpData = buffer, dwBufferLength = (uint)dataSize };\n    try {\n      uint headerSize = (uint)Marshal.SizeOf(typeof(WAVEHDR));\n      if (waveOutPrepareHeader(handle, header, headerSize) != 0) return 4;\n      if (waveOutWrite(handle, header, headerSize) != 0) return 5;\n      while ((header.dwFlags & 1) == 0) System.Threading.Thread.Sleep(20);\n      return 0;\n    } finally {\n      uint headerSize = (uint)Marshal.SizeOf(typeof(WAVEHDR));\n      waveOutUnprepareHeader(handle, header, headerSize);\n      waveOutClose(handle);\n      Marshal.FreeHGlobal(buffer);\n    }\n  }\n}\n'@\nAdd-Type -TypeDefinition $source -Language CSharp\nexit [WaveOutPlayer]::Play('${wavPath.replace(/'/g, "''")}', 'CABLE Input')`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', powershell], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`播放到 CABLE Input 失败，退出码 ${result.status || 1}\n${result.stderr || result.stdout}`);
  }
}

function parseVolume(stderr) {
  const mean = Number((stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/) || [])[1]);
  const maxText = (stderr.match(/max_volume:\s*(-?[\d.]+|-inf)\s*dB/) || [])[1];
  const max = maxText === '-inf' ? -Infinity : Number(maxText);
  return { mean, max };
}

(async () => {
  mkdirSync(toolsDir, { recursive: true });
  rmSync(toneFile, { force: true });
  rmSync(recordedFile, { force: true });

  console.log('生成测试音:', toneFile);
  await runFfmpeg([
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-ar', '48000', '-ac', '1', toneFile
  ], '生成测试音');

  console.log('开始从 CABLE Output 录音:', recordedFile);
  const recorderPromise = runFfmpeg([
    '-hide_banner', '-y',
    '-f', 'dshow', '-i', 'audio=CABLE Output (VB-Audio Virtual Cable)',
    '-t', String(recordSeconds), '-ar', '48000', '-ac', '1', recordedFile
  ], '录制 CABLE Output');

  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log('播放测试音到 CABLE Input');
  playToCableInput(toneFile);

  await recorderPromise;

  const volumeLog = await runFfmpeg([
    '-hide_banner', '-i', recordedFile,
    '-af', 'volumedetect',
    '-f', 'null', 'NUL'
  ], '分析录音音量');
  const volume = parseVolume(volumeLog);
  console.log('录音音量 mean:', Number.isFinite(volume.mean) ? `${volume.mean.toFixed(1)} dB` : 'N/A');
  console.log('录音音量 max :', Number.isFinite(volume.max) ? `${volume.max.toFixed(1)} dB` : '-inf dB');

  if (!Number.isFinite(volume.max) || volume.max <= -50) {
    throw new Error('录音音量过低，CABLE Input → CABLE Output 回环未验证通过');
  }

  console.log('VB-CABLE 回环验证通过');
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
