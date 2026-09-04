/**
 * Supabase Auth for T-Offer — same allowlist + password-setup flow as T-Client.
 * Uses a dedicated storage key so T-Client on the same GitHub Pages origin
 * cannot deadlock the auth navigator lock.
 */
(function () {
  let client = null;
  const STORAGE_KEY = "sb-toffer-auth";

  function cfg() {
    const c = window.TOfferSupabaseConfig ?? {};
    if (!c.url || !c.anonKey) throw new Error("Supabase 설정이 없습니다.");
    return c;
  }

  function getClient() {
    if (!client) {
      if (!window.supabase?.createClient) {
        throw new Error("Supabase SDK가 로드되지 않았습니다. 새로고침 후 다시 시도하세요.");
      }
      const c = cfg();
      client = window.supabase.createClient(c.url, c.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: STORAGE_KEY
        }
      });
    }
    return client;
  }

  function normalizeEmail(email) {
    const addr = `${email ?? ""}`.trim().toLowerCase();
    if (!addr.includes("@")) throw new Error("올바른 이메일을 입력하세요.");
    return addr;
  }

  function redirectBase() {
    return `${window.location.origin}${window.location.pathname}`.replace(/\/$/, "") + "/";
  }

  function mapAuthError(message) {
    const m = `${message ?? ""}`.toLowerCase();
    if (m.includes("rate limit")) {
      return "메일 발송 한도를 초과했습니다. 1시간 후 다시 시도하거나, 관리자에게 비밀번호 직접 설정을 요청하세요.";
    }
    if (m.includes("only request this after") || m.includes("security purposes")) {
      return "보안상 잠시 후에만 재발송할 수 있습니다. 1~2분 뒤 다시 시도해 주세요.";
    }
    if (m.includes("email address not authorized") || m.includes("invalid email")) {
      return "이메일 형식이 올바르지 않거나 발송 설정(SMTP)을 확인해야 합니다.";
    }
    if (m.includes("failed to fetch") || m.includes("network")) {
      return "네트워크 오류입니다. 잠시 후 다시 시도하세요.";
    }
    return message;
  }

  function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 시간이 초과되었습니다. 새로고침 후 다시 시도하세요.`)), ms);
      })
    ]);
  }

  async function checkAllowed(email) {
    const addr = normalizeEmail(email);
    const { url, anonKey } = cfg();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(`${url}/rest/v1/rpc/check_email_allowed`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ addr }),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error(`허용 이메일 확인 실패 (${res.status})`);
      return !!(await res.json());
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("허용 이메일 확인 시간이 초과되었습니다.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function assertAllowedEmail(email) {
    const ok = await checkAllowed(email);
    if (!ok) throw new Error("허용되지 않은 이메일입니다. 관리자에게 등록을 요청하세요.");
  }

  async function signIn(email, password) {
    const addr = normalizeEmail(email);
    const pwd = `${password ?? ""}`;
    if (pwd.length < 8) throw new Error("비밀번호는 8자 이상이어야 합니다.");
    await assertAllowedEmail(addr);
    const { data, error } = await withTimeout(
      getClient().auth.signInWithPassword({ email: addr, password: pwd }),
      20000,
      "로그인"
    );
    if (error) {
      if (/invalid login credentials/i.test(error.message)) {
        throw new Error(
          "이메일 또는 비밀번호가 올바르지 않습니다. 처음이면 「설정 메일 받기」로 비밀번호를 설정하세요."
        );
      }
      throw new Error(mapAuthError(error.message));
    }
    const session = data?.session ?? null;
    return {
      session,
      email: session?.user?.email?.toLowerCase() || addr
    };
  }

  async function sendPasswordSetupEmail(email) {
    const addr = normalizeEmail(email);
    await assertAllowedEmail(addr);
    const { error } = await withTimeout(
      getClient().auth.resetPasswordForEmail(addr, { redirectTo: redirectBase() }),
      20000,
      "설정 메일 발송"
    );
    if (error) throw new Error(mapAuthError(error.message));
    return true;
  }

  async function updatePassword(password) {
    const pwd = `${password ?? ""}`;
    if (pwd.length < 8) throw new Error("비밀번호는 8자 이상이어야 합니다.");
    const { data, error } = await withTimeout(
      getClient().auth.updateUser({ password: pwd }),
      20000,
      "비밀번호 저장"
    );
    if (error) throw new Error(error.message);
    return data;
  }

  async function signOut() {
    await getClient().auth.signOut();
  }

  async function getSession() {
    const { data, error } = await getClient().auth.getSession();
    if (error) throw new Error(error.message);
    return data.session;
  }

  window.TOfferAuth = {
    signIn,
    signInWithPassword: signIn,
    sendPasswordSetupEmail,
    updatePassword,
    signOut,
    getSession,
    requireSession: async () => {
      const session = await getSession();
      if (!session?.user?.email) throw new Error("로그인이 필요합니다.");
      return session;
    },
    getUserEmail: async () => (await getSession())?.user?.email?.toLowerCase() ?? "",
    getAccessToken: async () => (await getSession())?.access_token ?? "",
    onAuthStateChange: (cb) =>
      getClient().auth.onAuthStateChange((event, session) => {
        // Pass session from the event — do not call getSession() here (can deadlock).
        try {
          cb(event, session);
        } catch (err) {
          console.error(err);
        }
      })
  };
})();
