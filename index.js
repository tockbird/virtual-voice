'use strict';

const path = require('node:path');
const { VirtualAudioBridge } = require('./audio-bridge');

const audio = new VirtualAudioBridge({
  ffmpegPath: path.join(__dirname, 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe'),
  runtimeDir: path.join(__dirname, 'tools', 'audio-api')
});

console.log('virtual-audio-bridge SDK 已加载');
console.log('可用方法:', Object.getOwnPropertyNames(Object.getPrototypeOf(audio)).filter((name) => name !== 'constructor').join(', '));
console.log('运行目录:', audio.config.runtimeDir);

module.exports = audio;
