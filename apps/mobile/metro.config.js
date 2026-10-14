// Expo's default Metro config detects the pnpm workspace (watchFolders / nodeModulesPaths).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
