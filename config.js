/* ============================================================
   Food Court Tracker — Konfigurace cloudu (Supabase / Vercel)
   ============================================================
   Hodnoty můžete vložit sem před nasazením na Vercel, nebo
   je zadat přímo v aplikaci v okně "Nastavení databáze".
   Získat je můžete zdarma na https://supabase.com v Project Settings -> API.
*/
(() => {
  'use strict';

  // Výchozí konfigurace (propojeno s vaší Supabase PostgreSQL databází)
  const DEFAULT_CONFIG = {
    supabaseUrl: 'https://ludwxqvhdexkagwmzgwt.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1ZHd4cXZoZGV4a2Fnd216Z3d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxODM5NTYsImV4cCI6MjEwODc1OTk1Nn0.pUdwjZpgqZHmvcIhTjgvbBkoa8RsY1FacYqPWflvnjU'
  };

  function loadConfig() {
    try {
      const stored = localStorage.getItem('fnk_supabase_config');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          const u = (parsed.supabaseUrl && parsed.supabaseUrl.trim()) || DEFAULT_CONFIG.supabaseUrl;
          let k = (parsed.supabaseAnonKey && parsed.supabaseAnonKey.trim()) || DEFAULT_CONFIG.supabaseAnonKey;
          // Pokud byl v localStorage starý secret klíč nebo prázdný řetězec, použít platný anon klíč
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
