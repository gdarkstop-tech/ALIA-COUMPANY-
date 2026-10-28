// Realtime voice (ADR 0010) is linked only into builds that ship it — development and preview
// (see app.config.ts). Production store builds contain no native audio-recording code and request
// no microphone access until voice is approved for launch.
const voice = (process.env.APP_VARIANT ?? 'development') !== 'production';

module.exports = {
  dependencies: voice ? {} : { 'react-native-audio-api': { platforms: { ios: null, android: null } } },
};
