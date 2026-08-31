const cfg = window.TOfferSupabaseConfig || {};

export const TOfferSupabase = {
  async rpc(name, args = {}) {
    const url = `${cfg.url}/rest/v1/rpc/${name}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${cfg.anonKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(args)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${name} failed: ${res.status} ${text}`);
    }
    return res.json();
  },

  getDashboard() {
    return this.rpc("get_offer_dashboard");
  },

  getSnapshot() {
    return this.rpc("get_offer_published_snapshot");
  }
};
