const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const source = path.join(root, 'cpp', 'ShahaneBot.cpp');
const outDir = path.join(root, 'bin');
const output = path.join(outDir, isWindows ? 'ShahaneBot.exe' : 'ShahaneBot');

function candidateCompilers() {
  const list = [];
  if (process.env.CXX) list.push(process.env.CXX);
  if (isWindows) {
    list.push(
      'C:\\msys64\\ucrt64\\bin\\g++.exe',
      path.join(process.env.MSYS2_ROOT || 'C:\\msys64', 'ucrt64', 'bin', 'g++.exe')
    );
  }
  list.push('g++', 'c++');
  return [...new Set(list)];
}

function works(compiler) {
  const probe = spawnSync(compiler, ['--version'], { encoding: 'utf8', windowsHide: true });
  return !probe.error && probe.status === 0;
}

const compiler = candidateCompilers().find(works);

if (!compiler) {
  console.error('No C++ compiler found.');
  console.error('Install MSYS2 and run:  pacman -S mingw-w64-ucrt-x86_64-gcc');
  console.error('Or set the CXX environment variable to the full path of g++.exe.');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const args = ['-std=c++17', '-O2', '-Wall', '-Wextra', source, '-o', output];
if (isWindows) args.splice(4, 0, '-static');

console.log(`Compiler : ${compiler}`);
console.log(`Output   : ${output}`);

const result = spawnSync(compiler, args, { stdio: 'inherit', windowsHide: true });

if (result.error || result.status !== 0) {
  console.error('\nC++ build failed. See the compiler messages above.');
  process.exit(result.status || 1);
}

console.log('C++ build succeeded.');
