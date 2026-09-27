// Fails fast with a readable message when Node is too old for Vite / the toolchain.
// Deliberately old-style JavaScript so any Node version can parse it.
var MIN = [[20, 19], [22, 12]]; // ^20.19.0 || >=22.12.0

var version = process.env.DATADECK_FAKE_NODE_VERSION || process.versions.node;
var parts = version.split('.').map(Number);
var major = parts[0];
var minor = parts[1];

var ok = (major === 20 && minor >= MIN[0][1]) || major > 22 || (major === 22 && minor >= MIN[1][1]);

if (!ok) {
  console.error('');
  console.error('  DataDeck needs Node.js 22 LTS (or 20.19+). You are running Node ' + version + '.');
  console.error('');
  console.error('  Upgrade, then reinstall dependencies:');
  console.error('    nvm install 22 && nvm use 22          # with nvm (reads .nvmrc)');
  console.error('    brew install node@22 && brew link --overwrite node@22   # with Homebrew');
  console.error('    or download the installer from https://nodejs.org');
  console.error('');
  console.error('    rm -rf node_modules && npm install');
  console.error('');
  process.exit(1);
}
