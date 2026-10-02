'use strict';

const { existsSync } = require('node:fs');
const { join } = require('node:path');

/**
 * 解析 ffmpeg 可执行文件路径。
 * 优先使用项目内 tools/ffmpeg/bin/ffmpeg.exe，其次回退到系统 PATH 中的 ffmpeg。
 */
function resolveFfmpeg() {
  const local = join(__dirname, '..', 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe');
  if (existsSync(local)) return local;
  return 'ffmpeg';
}

module.exports = { resolveFfmpeg };
