'use strict';

/**
 * 下载便携版 ffmpeg (gyan.dev essentials) 并解压到 tools/ffmpeg。
 * 仅 Windows。已存在则跳过。
 *
 * 用法: node scripts/setup-ffmpeg.js
 */

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const ROOT = path.join(__dirname, '..');
const TOOLS = path.join(ROOT, 'tools');
const ZIP = path.join(TOOLS, 'ffmpeg.zip');
const BIN = path.join(TOOLS, 'ffmpeg', 'bin', 'ffmpeg.exe');

if (fs.existsSync(BIN)) {
  console.log('ffmpeg 已存在:', BIN);
  process.exit(0);
}

fs.mkdirSync(TOOLS, { recursive: true });

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const total = Number(res.headers['content-length'] || 0);
      let got = 0;
      res.on('data', (c) => {
        got += c.length;
        if (total) process.stdout.write(`\r下载中 ${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); console.log('\n下载完成'); resolve(); });
    });
    req.on('error', (e) => { file.close(); reject(e); });
  });
}

(async () => {
  console.log('下载 ffmpeg ...');
  await download(URL, ZIP);
  console.log('解压到 tools/ffmpeg ...');
  const extractDir = path.join(TOOLS, '_ffmpeg_extract');
  fs.rmSync(extractDir, { recursive: true, force: true });
  const ps = `Expand-Archive -LiteralPath '${ZIP}' -DestinationPath '${extractDir}' -Force`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
  // 找到解压出的 ffmpeg-xxx 目录
  const entries = fs.readdirSync(extractDir);
  const inner = entries.find((e) => /^ffmpeg/i.test(e));
  if (!inner) throw new Error('解压后未找到 ffmpeg 目录');
  fs.rmSync(path.join(TOOLS, 'ffmpeg'), { recursive: true, force: true });
  fs.renameSync(path.join(extractDir, inner), path.join(TOOLS, 'ffmpeg'));
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.unlinkSync(ZIP);
  console.log('完成:', BIN);
})().catch((e) => { console.error(e); process.exit(1); });
