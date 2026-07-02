const capabilityDefaults = {
  chat: false,
  streaming: false,
  toolCalls: false,
  vision: false,
  imageGeneration: false,
  imageEditing: false,
  speechSynthesis: false,
  speechTranscription: false,
  liveAudio: false,
  liveTranslate: false,
  nativeAudio: false
};

export const capabilityKeys = Object.freeze(Object.keys(capabilityDefaults));

export function defineCapabilityMatrix(overrides = {}) {
  const matrix = { ...capabilityDefaults };
  for (const key of capabilityKeys) {
    if (Object.hasOwn(overrides, key)) {
      matrix[key] = Boolean(overrides[key]);
    }
  }
  return Object.freeze(matrix);
}
