export const API_BASE_URL = 'https://sifxwm8frqzlcu-8000.proxy.runpod.net';

export const ENDPOINTS = {
  stt:            `${API_BASE_URL}/stt`,
  wakeStt:        `${API_BASE_URL}/wake_stt`,
  processCommand: `${API_BASE_URL}/process_command`,
  describe:       `${API_BASE_URL}/describe`,
  recognize:      `${API_BASE_URL}/recognize`,
  identify:       `${API_BASE_URL}/identify`,
  where:          `${API_BASE_URL}/where`,
  findScan:       `${API_BASE_URL}/find/scan`,
  findWalk:       `${API_BASE_URL}/find/walk`,
  registerFace:   `${API_BASE_URL}/register_face`,
  stickerSetup:   `${API_BASE_URL}/sticker/setup`,
};

export const WS_BASE_URL = API_BASE_URL.replace('https://', 'wss://');