const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

const ids = new Set();
const re = /\$\('#([A-Za-z0-9_-]+)'\)/g;
let m;
while ((m = re.exec(appJs))) ids.add(m[1]);
const dynRe = /\$\('#([A-Za-z0-9_-]+)' \+/g; // dynamic '#'+x
// collect '#row-customsManual' style references too
const re2 = /'#([A-Za-z0-9_-]+)'/g;
while ((m = re2.exec(appJs))) {
  if (/(^|[^A-Za-z0-9_-])#/.test(m[0])) ids.add(m[1]);
}

const missing = [];
const dynamicPrefixes = ['s-', 'tab-'];
ids.forEach((id) => {
  if (dynamicPrefixes.some((p) => id.startsWith(p))) return;
  if (!html.includes('id="' + id + '"') && !html.includes("id='" + id + "'")) missing.push(id);
});

console.log('referenced ids:', ids.size);
if (missing.length) {
  console.log('MISSING IN HTML:', missing.join(', '));
  process.exit(1);
} else {
  console.log('ALL ID REFERENCES OK');
}
