const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const exe = path.join(root, 'bin', process.platform === 'win32' ? 'ShahaneBot.exe' : 'ShahaneBot');
const source = path.join(root, 'cpp', 'ShahaneBot.cpp');

const upToDate = fs.existsSync(exe) && fs.statSync(exe).mtimeMs >= fs.statSync(source).mtimeMs;

if (upToDate) {
  process.exit(0);
}

console.log('Building the C++ engine (first run or source changed)...');
const result = spawnSync(process.execPath, [path.join(__dirname, 'build-cpp.js')], { stdio: 'inherit' });

if (result.status !== 0) {
  console.warn('\nThe C++ engine could not be built. The website and AI chat will still start,');
  console.warn('but the C++ calculator and Q&A notes will be unavailable until you fix the build.');
}

process.exit(0);
