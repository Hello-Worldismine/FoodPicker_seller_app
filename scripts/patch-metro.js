const fs = require('fs');
const path = require('path');

// Packages that expose virtual ./private/* paths mapped to ./src/*
// These need the exports field to preserve that mapping
const PRIVATE_MAP_PACKAGES = [
  'metro',
  'metro-core',
  'metro-cache',
  'metro-config',
  'metro-file-map',
  'metro-source-map',
  'metro-transform-plugins',
  'metro-transform-worker',
  'metro-babel-transformer',
  'metro-minify-terser',
  'metro-resolver',
  'metro-symbolicate',
  'metro-runtime',
  'metro-cache-key',
];

const nodeModules = path.join(__dirname, '..', 'node_modules');

function patchPackage(pkgName) {
  const pkgPath = path.join(nodeModules, pkgName, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;

  const raw = fs.readFileSync(pkgPath, 'utf8').replace(/^﻿/, '');
  const pkg = JSON.parse(raw);

  const srcDir = path.join(nodeModules, pkgName, 'src');
  const hasPrivateMapping = PRIVATE_MAP_PACKAGES.includes(pkgName);

  // Build new exports that allow both private/* and src/* access
  const newExports = {
    '.': pkg.main ? `./${pkg.main.replace(/^\.\//, '')}` : './src/index.js',
    './package.json': './package.json',
  };

  if (fs.existsSync(srcDir)) {
    if (hasPrivateMapping) {
      newExports['./private/*'] = './src/*.js';
    }
    // Allow direct src access without extension (requires -> .js)
    newExports['./src/*'] = './src/*.js';
    // Allow direct src access with .js extension already present
    newExports['./src/*.js'] = './src/*.js';
  }

  pkg.exports = newExports;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
  return true;
}

const metroPackages = [
  'metro',
  'metro-babel-transformer',
  'metro-cache',
  'metro-cache-key',
  'metro-config',
  'metro-core',
  'metro-file-map',
  'metro-minify-terser',
  'metro-resolver',
  'metro-runtime',
  'metro-source-map',
  'metro-symbolicate',
  'metro-transform-plugins',
  'metro-transform-worker',
];

for (const pkgName of metroPackages) {
  if (patchPackage(pkgName)) {
    console.log(`✓ Patched ${pkgName}`);
  }
}

console.log('✓ Metro patch complete (Node.js v22+ compatibility)');
