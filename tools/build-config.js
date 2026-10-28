/* ============================================================
   Food Court Tracker — Build Config Generator (Vercel)
   Čte proměnné prostředí (Environment Variables) nastavené
   ve Vercelu (SUPABASE_URL, SUPABASE_ANON_KEY) a zapisuje je
   při buildu do config.js.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const envUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const envKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';

const configPath = path.join(__dirname, '..', 'config.js');

if (envUrl || envKey) {
  const currentContent = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';

  const finalUrl = envUrl || 'https://ludwxqvhdexkagwmzgwt.supabase.co';
  const finalKey = envKey || '';

  const newContent = `/* ============================================================
   Food Court Tracker — Konfigurace cloudu (Supabase / Vercel)
   Automaticky vygenerováno z Environment Variables při buildu.
   ============================================================ */
(() => {
  'use strict';

  const DEFAULT_CONFIG = {
    supabaseUrl: '${finalUrl.trim()}',
    supabaseAnonKey: '${finalKey.trim()}'
  };

  function loadConfig() {
    try {
      const stored = localStorage.getItem('fnk_supabase_config');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          const u = (parsed.supabaseUrl && parsed.supabaseUrl.trim()) || DEFAULT_CONFIG.supabaseUrl;
          let k = (parsed.supabaseAnonKey && parsed.supabaseAnonKey.trim()) || DEFAULT_CONFIG.supabaseAnonKey;
          if (!k || k.startsWith('sb_secret_')) {
            k = DEFAULT_CONFIG.supabaseAnonKey;
          }
          return { supabaseUrl: u, supabaseAnonKey: k };
        }
      }
    } catch {}
    return { ...DEFAULT_CONFIG };
  }

  window.APP_CONFIG = loadConfig();

  window.saveAppConfig = function(url, key) {
    window.APP_CONFIG.supabaseUrl = (url || '').trim();
    window.APP_CONFIG.supabaseAnonKey = (key || '').trim();
    try {
      localStorage.setItem('fnk_supabase_config', JSON.stringify(window.APP_CONFIG));
    } catch {}
  };
})();
`;

  fs.writeFileSync(configPath, newContent, 'utf8');
  console.log('[build-config] config.js byl úspěšně vygenerován s údaji z Vercel Environment Variables.');
} else {
  console.log('[build-config] Žádné proměnné prostředí pro Supabase nebyly předány, ponechávám stávající config.js.');
}
