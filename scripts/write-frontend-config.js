const fs = require('fs');
const path = require('path');

const apiUrl = (
  process.env.FAITH_ENGINE_API_URL ||
  process.env.VITE_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  ''
).trim().replace(/\/+$/, '');

const outputPath = path.join(__dirname, '../public/config.js');
const contents = `window.FAITH_ENGINE_API_URL = ${JSON.stringify(apiUrl)};\n`;

fs.writeFileSync(outputPath, contents, 'utf8');
console.log(`Wrote public/config.js with ${apiUrl ? 'configured API URL' : 'same-origin API fallback'}.`);
