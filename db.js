/* ============================================================
   Food Court Tracker — Databázová vrstva (db.js)
   Přímo propojeno se Supabase PostgreSQL (PostgREST REST API):
   - Žádné hesla ani přihlašování
   - Výběr osoby: Vojta, Peťa, Adél + možnost přidání nového jména a loga
   - Každý má svůj vlastní záznam, hodnocení i datum
   - Automatická synchronizace do cloudu na Vercelu i lokální mezipaměť
   ============================================================ */
(() => {
  'use strict';

  // Výchozí členové
  const DEFAULT_MEMBERS = [
    { id: 'vojta', name: 'Vojta', color: '#2563eb', logo: '👑' },
    { id: 'peta',  name: 'Peťa',  color: '#e11d48', logo: '🍕' },
    { id: 'adel',  name: 'Adél',  color: '#9333ea', logo: '✨' }
  ];

  const MEMBERS_KEY = 'fnk_members_v2';
  const REVIEWS_KEY = 'fnk_reviews_v2';
  const ACTIVE_AUTHOR_KEY = 'fnk_active_author_v2';

  let isCloudActive = false;
  let members = [];
  let reviews = {}; // { [venueId]: { [authorId]: { visited, rating, note, date } } }
  let activeAuthorId = 'vojta';
  let listeners = [];

  const notifyChange = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

  function getHeaders() {
    const cfg = window.APP_CONFIG || {};
    return {
      'apikey': cfg.supabaseAnonKey,
      'Authorization': 'Bearer ' + cfg.supabaseAnonKey,
      'Content-Type': 'application/json'
    };
  }

  function getBaseUrl() {
    const cfg = window.APP_CONFIG || {};
    return (cfg.supabaseUrl || '').replace(/\/+$/, '');
  }

  function loadLocalState() {
    try {
      const storedM = localStorage.getItem(MEMBERS_KEY);
      members = storedM ? JSON.parse(storedM) : [...DEFAULT_MEMBERS];
    } catch {
      members = [...DEFAULT_MEMBERS];
    }

    try {
      const storedR = localStorage.getItem(REVIEWS_KEY);
      reviews = storedR ? JSON.parse(storedR) : {};
    } catch {
      reviews = {};
    }

    try {
      const act = localStorage.getItem(ACTIVE_AUTHOR_KEY);
      if (act && members.some(m => m.id === act)) activeAuthorId = act;
      else activeAuthorId = members[0] ? members[0].id : 'vojta';
    } catch {
      activeAuthorId = 'vojta';
    }
  }

  function saveLocalState() {
    try {
      localStorage.setItem(MEMBERS_KEY, JSON.stringify(members));
      localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews));
      localStorage.setItem(ACTIVE_AUTHOR_KEY, activeAuthorId);
    } catch (e) {
      console.warn('[DB] Nelze uložit do localStorage:', e);
    }
  }

  const DB = {
    isConfigured() {
      const cfg = window.APP_CONFIG || {};
      return Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && cfg.supabaseUrl.startsWith('http'));
    },

    isCloud() {
      return isCloudActive;
    },

    async init() {
      loadLocalState();

      if (this.isConfigured()) {
        try {
          const baseUrl = getBaseUrl();
          const headers = getHeaders();

          let membersLoaded = false;
          let reviewsLoaded = false;

          // 1. Načteme členy ze Supabase
          const resM = await fetch(baseUrl + '/rest/v1/members?select=*', { headers });
          if (resM.ok) {
            const dbMembers = await resM.json();
            if (Array.isArray(dbMembers) && dbMembers.length) {
              const existingIds = new Set(dbMembers.map(m => m.id));
              const mergedMembers = [...dbMembers];
              DEFAULT_MEMBERS.forEach(def => {
                if (!existingIds.has(def.id)) mergedMembers.push(def);
              });
              members = mergedMembers;

              // Zachovat aktivního autora z paměti prohlížeče
              const savedAct = localStorage.getItem(ACTIVE_AUTHOR_KEY);
              if (savedAct && members.some(m => m.id === savedAct)) {
                activeAuthorId = savedAct;
              } else if (!members.some(m => m.id === activeAuthorId)) {
                activeAuthorId = members[0] ? members[0].id : 'vojta';
              }
            }
            membersLoaded = true;
          } else {
            console.error('[DB] Nelze načíst členy ze Supabase:', resM.status, await resM.text());
          }

          // 2. Načteme recenze ze Supabase
          const resR = await fetch(baseUrl + '/rest/v1/reviews?select=*', { headers });
          if (resR.ok) {
            const dbReviews = await resR.json();
            if (Array.isArray(dbReviews)) {
              const cloudReviews = Object.create(null);
              dbReviews.forEach(r => {
                const vId = String(r.venue_id || '').slice(0, 100);
                const aId = String(r.author_id || '').slice(0, 50);
                if (!vId || !aId || vId === '__proto__' || aId === '__proto__') return;
                if (!cloudReviews[vId]) cloudReviews[vId] = Object.create(null);
                const ratingNum = Number(r.rating || 0);
                cloudReviews[vId][aId] = {
                  visited: Boolean(r.visited),
                  rating: Math.max(0, Math.min(5, isNaN(ratingNum) ? 0 : Math.round(ratingNum))),
                  note: String(r.note || '').slice(0, 1000),
                  date: (r.visit_date && /^\d{4}-\d{2}-\d{2}$/.test(String(r.visit_date))) ? String(r.visit_date) : null
                };
              });
              reviews = cloudReviews;
            }
            reviewsLoaded = true;
          } else {
            console.error('[DB] Nelze načíst recenze ze Supabase:', resR.status, await resR.text());
          }

          isCloudActive = membersLoaded && reviewsLoaded;
          saveLocalState();
          notifyChange();
          return isCloudActive;
        } catch (err) {
          console.warn('[DB] Supabase není dostupná, používám lokální data:', err);
          isCloudActive = false;
        }
      }

      isCloudActive = false;
      notifyChange();
      return false;
    },

    onChange(cb) {
      if (typeof cb === 'function') listeners.push(cb);
    },

    getMembers() {
      return members || [];
    },

    getMember(id) {
      return (members || []).find(m => m.id === id) || null;
    },

    getActiveAuthorId() {
      return activeAuthorId;
    },

    getActiveAuthor() {
      return this.getMember(activeAuthorId) || members[0] || null;
    },

    setActiveAuthorId(id) {
      if (members.some(m => m.id === id)) {
        activeAuthorId = id;
        saveLocalState();
        notifyChange();
      }
    },

    // Přidání nového jména a loga/symbolu
    async addMember(name, color = '#3b8559', logo = '🍔') {
      name = (name || '').trim().replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
      if (!name) throw new Error('Zadejte jméno osoby.');
      if (name.length > 30) throw new Error('Jméno je příliš dlouhé (max 30 znaků).');

      // Bezpečné ID (normalizace české diakritiky, zachování pouze a-z0-9_-)
      const cleanId = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_-]/g, '') || ('person_' + Date.now());
      if (cleanId === '__proto__' || cleanId === 'constructor' || cleanId === 'prototype') {
        throw new Error('Neplatné jméno osoby.');
      }

      if (members.some(m => m.name.toLowerCase() === name.toLowerCase() || m.id === cleanId)) {
        throw new Error('Osoba s tímto jménem již existuje.');
      }

      const safeColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#3b8559';
      const safeLogo = (logo || '🍔').trim().slice(0, 8);

      const newMember = {
        id: cleanId,
        name: name,
        color: safeColor,
        logo: safeLogo
      };

      members.push(newMember);
      activeAuthorId = newMember.id;
      saveLocalState();

      if (isCloudActive && this.isConfigured()) {
        try {
          const baseUrl = getBaseUrl();
          const headers = getHeaders();
          await fetch(baseUrl + '/rest/v1/members?on_conflict=id', {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify([newMember])
          });
        } catch (e) {
          console.warn('[DB] Nepodařilo se uložit člena do cloudu:', e);
        }
      }

      notifyChange();
      return newMember;
    },

    // Uložení recenze podniku pro vybranou osobu
    async saveReview(venueId, authorId, data, skipNotify = false) {
      if (!venueId || !authorId) return;
      const vId = String(venueId).trim().slice(0, 100);
      const aId = String(authorId).trim().slice(0, 50);
      if (vId === '__proto__' || aId === '__proto__') return;

      if (!reviews[vId]) reviews[vId] = {};

      const ratingNum = Number(data.rating || 0);
      const safeRating = Math.max(0, Math.min(5, isNaN(ratingNum) ? 0 : Math.round(ratingNum)));
      const safeNote = String(data.note || '').slice(0, 1000).replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, '');
      let safeDate = null;
      if (data.date && /^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) {
        safeDate = String(data.date);
      }

      const rec = {
        visited: Boolean(data.visited),
        rating: safeRating,
        note: safeNote,
        date: safeDate
      };

      reviews[vId][aId] = rec;
      saveLocalState();

      if (isCloudActive && this.isConfigured()) {
        try {
          const baseUrl = getBaseUrl();
          const headers = getHeaders();
          const res = await fetch(baseUrl + '/rest/v1/reviews?on_conflict=venue_id,author_id', {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify([{
              venue_id: vId,
              author_id: aId,
              visited: rec.visited,
              rating: rec.rating,
              note: rec.note,
              visit_date: rec.date,
              updated_at: new Date().toISOString()
            }])
          });
          if (!res.ok) {
            console.error('[DB] Chyba při odesílání do Supabase:', res.status, await res.text());
          }
        } catch (e) {
          console.error('[DB] Chyba při odesílání do Supabase:', e);
        }
      }

      if (!skipNotify) {
        notifyChange();
      }
    },

    // Smazání recenze podniku pro danou osobu
    async deleteReview(venueId, authorId) {
      if (reviews[venueId] && reviews[venueId][authorId]) {
        delete reviews[venueId][authorId];
        saveLocalState();

        if (isCloudActive && this.isConfigured()) {
          try {
            const baseUrl = getBaseUrl();
            const headers = getHeaders();
            await fetch(baseUrl + `/rest/v1/reviews?venue_id=eq.${encodeURIComponent(venueId)}&author_id=eq.${encodeURIComponent(authorId)}`, {
              method: 'DELETE',
              headers
            });
          } catch (e) {
            console.error('[DB] Chyba při mazání recenze:', e);
          }
        }

        notifyChange();
      }
    },

    // Kompletní reset databáze (lokálně i v cloudu)
    async resetDatabase(includeMembers = false) {
      reviews = {};
      if (includeMembers) {
        members = [...DEFAULT_MEMBERS];
        activeAuthorId = 'vojta';
      }
      saveLocalState();

      if (isCloudActive && this.isConfigured()) {
        try {
          const baseUrl = getBaseUrl();
          const headers = getHeaders();
          await fetch(baseUrl + '/rest/v1/reviews?id=not.is.null', {
            method: 'DELETE',
            headers
          });

          if (includeMembers) {
            await fetch(baseUrl + '/rest/v1/members?id=not.in.(vojta,peta,adel)', {
              method: 'DELETE',
              headers
            });
          }
        } catch (e) {
          console.error('[DB] Chyba při resetování cloudu:', e);
        }
      }

      notifyChange();
    },

    // Získání recenze konkrétního člověka
    getReview(venueId, authorId) {
      return (reviews[venueId] && reviews[venueId][authorId]) || null;
    },

    // Získání všech recenzí k danému podniku
    getVenueReviews(venueId) {
      const vReviews = reviews[venueId] || {};
      return Object.entries(vReviews).map(([authId, rev]) => {
        const mem = this.getMember(authId);
        return {
          authorId: authId,
          authorName: mem ? mem.name : authId,
          authorColor: mem ? mem.color : '#6b655d',
          authorLogo: mem ? mem.logo : '👤',
          visited: rev.visited,
          rating: rev.rating,
          note: rev.note,
          date: rev.date
        };
      });
    },

    // Statistiky podniku (kdo tam byl, průměrné hodnocení)
    getVenueStats(venueId) {
      const all = this.getVenueReviews(venueId);
      const visited = all.filter(r => r.visited);
      const rated = all.filter(r => r.rating > 0);
      const avg = rated.length ? +(rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1) : null;

      return {
        visitorCount: visited.length,
        ratingCount: rated.length,
        avgRating: avg,
        visitors: visited.map(r => ({
          id: r.authorId,
          name: r.authorName,
          color: r.authorColor,
          logo: r.authorLogo,
          rating: r.rating
        }))
      };
    },

    // Zjistit, zda daný člověk navštívil podnik
    isVisitedBy(venueId, authorId) {
      if (!authorId || authorId === 'all') {
        const vr = reviews[venueId];
        return Boolean(vr && Object.values(vr).some(r => r.visited));
      }
      return Boolean(reviews[venueId] && reviews[venueId][authorId] && reviews[venueId][authorId].visited);
    },

    // Počet navštívených podniků danou osobou
    getVisitedCount(authorId) {
      let count = 0;
      Object.keys(reviews).forEach(vId => {
        if (this.isVisitedBy(vId, authorId)) count++;
      });
      return count;
    },

    // Celkové statistiky pro přehled
    getAllStats(allVenueIds) {
      const memberStats = members.map(m => {
        const visitedVenues = allVenueIds.filter(vId => this.isVisitedBy(vId, m.id));
        const ratedVenues = allVenueIds.filter(vId => {
          const r = this.getReview(vId, m.id);
          return r && r.rating > 0;
        });
        const avg = ratedVenues.length
          ? +(ratedVenues.reduce((s, vId) => s + this.getReview(vId, m.id).rating, 0) / ratedVenues.length).toFixed(1)
          : '–';

        return {
          member: m,
          visitedCount: visitedVenues.length,
          avgRating: avg
        };
      }).sort((a, b) => b.visitedCount - a.visitedCount);

      // Kde byli všichni
      const allMembers = members.map(m => m.id);
      const commonVenues = allVenueIds.filter(vId => {
        return allMembers.length > 0 && allMembers.every(mId => this.isVisitedBy(vId, mId));
      });

      // Kde nebyl ještě nikdo
      const unvisitedVenues = allVenueIds.filter(vId => !this.isVisitedBy(vId, 'all'));

      return {
        memberStats,
        commonVenues,
        unvisitedVenues
      };
    }
  };

  window.DB = DB;
})();
