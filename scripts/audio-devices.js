'use strict';

/**
 * 列出 Windows 上 ffmpeg (dshow) 可见的音频输入/输出设备，
 * 重点确认 VB-CABLE 的 CABLE Input / CABLE Output 是否被识别。
 *
 * 用法: node scripts/audio-devices.js
 */

const { spawn } = require('node:child_process');
const { resolveFfmpeg } = require('../lib/ffmpeg');

const ffmpeg = resolveFfmpeg();

const child = spawn(ffmpeg, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
  windowsHide: true
});

let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
child.on('error', (err) => {
  console.error('无法启动 ffmpeg:', err.message);
  console.error('请先运行: npm run setup:ffmpeg');
  process.exit(1);
});
child.on('close', () => {
  const lines = stderr.split(/\r?\n/);
  let section = null;
  const video = [];
  const audio = [];
  for (const line of lines) {
    if (/DirectShow video devices/.test(line)) { section = 'video'; continue; }
    if (/DirectShow audio devices/.test(line)) { section = 'audio'; continue; }
    if (/Alternative name/.test(line)) continue;
    const m = line.match(/"(.+)" \((audio|video)\)/);
    if (m) {
      (m[2] === 'video' ? video : audio).push(m[1]);
    }
  }

  console.log('=== 音频输入设备 (录音) ===');
  for (const d of audio) console.log('  -', d);
  console.log('');
  console.log('=== 视频设备 (忽略) ===');
  for (const d of video) console.log('  -', d);
  console.log('');

  const cableOut = audio.find((d) => /CABLE Output/i.test(d));
  const cableIn = audio.find((d) => /CABLE Input/i.test(d));
  console.log('=== VB-CABLE 检测 ===');
  console.log('  CABLE Output (可作为 ASR 采集源):', cableOut ? cableOut : '未发现');
  console.log('  CABLE Input  (可作为 TTS 播放目标):', cableIn ? cableIn : '未发现');

  if (!cableOut) {
    console.error('\n错误: 未识别到 CABLE Output，无法作为 ASR 采集源。');
    process.exit(2);
  }
  console.log('\n说明: CABLE Input 是播放设备，DirectShow 的输入设备枚举不会列出它；后续播放测试时将使用它作为 TTS 输出目标。');
});
