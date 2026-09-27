// Startup checks for npm run dev / start / build, with readable fixes instead of
// cryptic Vite errors. Deliberately old-style JavaScript so any Node version can parse it.
var fs = require('fs');
var path = require('path');

// 1. Node version: Vite needs ^20.19.0 || >=22.12.0.
var MIN = [[20, 19], [22, 12]];
var version = process.env.DATADECK_FAKE_NODE_VERSION || process.versions.node;
var parts = version.split('.').map(Number);
var major = parts[0];
var minor = parts[1];
var nodeOk = (major === 20 && minor >= MIN[0][1]) || major > 22 || (major === 22 && minor >= MIN[1][1]);

if (!nodeOk) {
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

// 2. Dependencies: after pulling an update that adds a package, node_modules is stale.
var root = path.resolve(__dirname, '..');
var pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
var names = Object.keys(pkg.dependencies || {}).concat(Object.keys(pkg.devDependencies || {}));
var missing = names.filter(function (name) {
  return !fs.existsSync(path.join(root, 'node_modules', name, 'package.json'));
});

if (missing.length) {
  var shown = missing.slice(0, 5).join(', ') + (missing.length > 5 ? ', …' : '');
  console.error('');
  console.error("  DataDeck's dependencies have changed (missing: " + shown + ').');
  console.error('  Run:  npm install');
  console.error('');
  process.exit(1);
}
