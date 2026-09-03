'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Jembatan sempit antara UI dan proses main. UI tidak punya akses Node
// langsung — semua lewat channel yang terdaftar di sini.
contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  listProviders: () => ipcRenderer.invoke('providers:list'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  // Electron 34 sudah menghapus File.path; getPathForFile penggantinya.
  pathForFile: (file) => webUtils.getPathForFile(file),
  readFiles: (paths) => ipcRenderer.invoke('files:read', paths),
  // Gambar hasil Ctrl+V. `bytes` berupa Uint8Array — dikirim apa adanya lewat
  // structured clone, jadi tidak perlu diubah ke base64 di renderer (untuk
  // gambar besar, cara itu justru meledakkan stack).
  pasteImage: (mediaType, bytes) => ipcRenderer.invoke('files:paste', { mediaType, bytes }),
  fetchModels: (providerId) => ipcRenderer.invoke('providers:fetchModels', providerId),

  // Login Claude Code tanpa terminal: aplikasi mengemudikan binary resmi yang
  // sudah ikut dibawa SDK, membuka URL-nya di browser, lalu meneruskan kode
  // yang kamu tempel ke stdin proses itu.
  claudeAuthStatus: () => ipcRenderer.invoke('claude:authStatus'),
  claudeLogin: () => ipcRenderer.invoke('claude:login'),
  claudeLoginInput: (teks) => ipcRenderer.invoke('claude:loginInput', teks),
  claudeLoginCancel: () => ipcRenderer.invoke('claude:loginCancel'),
  claudeLogout: () => ipcRenderer.invoke('claude:logout'),
  onClaudeLoginEvent: (fn) => ipcRenderer.on('claude:login-event', (_e, p) => fn(p)),
  // Dipakai saat fokus keyboard tersangkut di menu <select> milik Windows.
  refocusWindow: () => ipcRenderer.invoke('window:refocus'),

  // Server MCP: toolnya ikut disodorkan ke agen bersama tool bawaan.
  mcpStatus: () => ipcRenderer.invoke('mcp:status'),
  mcpConnect: (id) => ipcRenderer.invoke('mcp:connect', id),
  mcpDisconnect: (id) => ipcRenderer.invoke('mcp:disconnect', id),

  telegramDetect: (token) => ipcRenderer.invoke('telegram:detect', token),
  telegramTest: (token, chatId) => ipcRenderer.invoke('telegram:test', { token, chatId }),
  telegramStart: () => ipcRenderer.invoke('telegram:start'),
  telegramStop: () => ipcRenderer.invoke('telegram:stop'),
  telegramState: () => ipcRenderer.invoke('telegram:state'),

  listSessions: () => ipcRenderer.invoke('sessions:list'),
  // folder opsional: kalau diisi, dialog pilih folder dilewati dan sesi barunya
  // langsung menempel di folder itu.
  createSession: (folder) => ipcRenderer.invoke('sessions:create', folder),
  openSession: (id) => ipcRenderer.invoke('sessions:open', id),
  sessionHistory: (id) => ipcRenderer.invoke('sessions:history', id),
  renameSession: (id, title) => ipcRenderer.invoke('sessions:rename', { id, title }),
  setSessionFolder: (id) => ipcRenderer.invoke('sessions:setFolder', id),
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),

  // Semua perintah agen membawa id proyeknya: beberapa proyek bisa bekerja
  // bersamaan, jadi "yang aktif" bukan lagi alamat yang jelas.
  send: (sessionId, text, attachments) =>
    ipcRenderer.invoke('agent:send', { sessionId, text, attachments }),
  stop: (sessionId) => ipcRenderer.invoke('agent:stop', sessionId),
  compact: (sessionId) => ipcRenderer.invoke('agent:compact', sessionId),
  approve: (id, decision) => ipcRenderer.invoke('agent:approve', { id, decision }),
  // Jawaban pertanyaan pilihan dari agen; answers = null berarti tidak dijawab.
  answer: (id, answers) => ipcRenderer.invoke('agent:answer', { id, answers }),

  // Antrean pesan: dikirim saat agen masih bekerja, berangkat sendiri setelah
  // gilirannya selesai — atau langsung diselipkan lewat "Kirim sekarang".
  queueList: (sessionId) => ipcRenderer.invoke('agent:queue-list', sessionId),
  queueNow: (sessionId, itemId) => ipcRenderer.invoke('agent:queue-now', { sessionId, itemId }),
  queueCancel: (sessionId, itemId) =>
    ipcRenderer.invoke('agent:queue-cancel', { sessionId, itemId }),
  onQueue: (fn) => ipcRenderer.on('agent:queue', (_e, payload) => fn(payload)),

  onEvent: (fn) => ipcRenderer.on('agent:event', (_e, payload) => fn(payload)),
  onApprovalRequest: (fn) =>
    ipcRenderer.on('agent:approval-request', (_e, payload) => fn(payload)),
  onApprovalResolved: (fn) =>
    ipcRenderer.on('agent:approval-resolved', (_e, payload) => fn(payload)),
  onQuestion: (fn) => ipcRenderer.on('agent:question', (_e, payload) => fn(payload)),
  onSessionsChanged: (fn) => ipcRenderer.on('sessions:changed', () => fn()),
  // Daftar proyek yang sedang bekerja — untuk titik "berjalan" di sidebar.
  onSessionsBusy: (fn) => ipcRenderer.on('sessions:busy', (_e, payload) => fn(payload)),
  // Pesan yang dikirim dari HP — desktop ikut menampilkannya.
  onRemoteUser: (fn) => ipcRenderer.on('agent:remote-user', (_e, payload) => fn(payload)),
  onSessionSwitched: (fn) => ipcRenderer.on('session:switched', (_e, payload) => fn(payload)),
  onTelegramStatus: (fn) => ipcRenderer.on('telegram:status', (_e, payload) => fn(payload)),
});
